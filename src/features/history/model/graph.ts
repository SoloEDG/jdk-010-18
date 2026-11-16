import type { Element, LabDocument } from "../../../shared/document";
import { labels } from "../../../shared/document";

/**
 * 历史 = 有向节点图 + 命名分支。每个节点保存某一时刻的完整实验状态。
 *
 * 存储权衡 —— 完整快照 vs 命令重放：
 * 选择快照。单个文档最多 80 个器件（约 1–12 KB JSON），配合 MAX_NODES
 * 上限、删除分支后的 GC、以及超长时的中段压缩，内存与 localStorage
 * 占用都可控；换来的是：任意节点 O(1) 直达，且器件 id、任务上下文在
 * 提交时刻被冻结，保存重开后仍一一对应。命令重放虽然只需 O(操作数)
 * 空间，但要求每一次变更（包括 crypto.randomUUID 生成的器件 id、任务
 * 预设内容）都被完整且确定地记录与回放，任何非确定来源都会让重放结果
 * 与历史静默分叉 —— 在文档足够小的前提下，快照的确定性更值得。
 */

export interface NodeContext {
  /** 提交时所在的实验任务 id */
  mission: string;
  /** 提交时选中的接收屏器件 id（可能已不在文档中，导航时需回退） */
  screen: string | null;
}

export interface HistoryNode {
  id: string;
  parent: string | null;
  /** 创建序号，用于确定性的压缩与回退排序 */
  seq: number;
  label: string;
  doc: LabDocument;
  context: NodeContext;
}

export interface Branch {
  id: string;
  name: string;
  /** 分支尖端节点 id；分支路径 = 从 tip 沿 parent 走到根 */
  tip: string;
  seq: number;
}

export interface HistoryGraph {
  nodes: Record<string, HistoryNode>;
  branches: Record<string, Branch>;
  /** current.node 必位于 current.branch 的路径上（不变式） */
  current: { branch: string; node: string };
  seq: number;
}

/** 节点总数上限；超出时压缩最古老的中段节点（见 prune） */
export const MAX_NODES = 80;
/** 连续调节在此时间窗内聚合为同一历史节点 */
export const AGGREGATE_MS = 1200;

export interface LastCommit {
  key: string;
  at: number;
  node: string;
}

export type IdGen = () => string;
const defaultIds: IdGen = () => crypto.randomUUID();

export function createGraph(
  doc: LabDocument,
  context: NodeContext,
  label = "初始状态",
  ids: IdGen = defaultIds,
): HistoryGraph {
  const root: HistoryNode = { id: ids(), parent: null, seq: 1, label, doc, context };
  const branch: Branch = { id: ids(), name: "主分支", tip: root.id, seq: 1 };
  return {
    nodes: { [root.id]: root },
    branches: { [branch.id]: branch },
    current: { branch: branch.id, node: root.id },
    seq: 1,
  };
}

/** 当前分支从根到尖端的路径 */
export function branchPath(g: HistoryGraph, branchId: string): HistoryNode[] {
  const branch = g.branches[branchId];
  if (!branch) return [];
  const path: HistoryNode[] = [];
  const seen = new Set<string>();
  let id: string | null = branch.tip;
  while (id && !seen.has(id)) {
    seen.add(id);
    const node: HistoryNode | undefined = g.nodes[id];
    if (!node) break;
    path.push(node);
    id = node.parent;
  }
  return path.reverse();
}

function childCount(g: HistoryGraph, id: string): number {
  let n = 0;
  for (const node of Object.values(g.nodes)) if (node.parent === id) n++;
  return n;
}

function nextBranchName(branches: Record<string, Branch>): string {
  const names = new Set(Object.values(branches).map((b) => b.name));
  let i = Object.keys(branches).length + 1;
  while (names.has(`分支 ${i}`)) i++;
  return `分支 ${i}`;
}

export interface CommitOptions {
  /** 聚合键：相同键且时间窗内的连续提交会合并（修改当前节点而非新建） */
  key?: string;
  now: number;
}

export interface CommitResult {
  graph: HistoryGraph;
  /** 供下一次提交判断聚合；边界操作（无 key）返回 null，切断聚合链 */
  last: LastCommit | null;
  amended: boolean;
  forked: boolean;
}

/**
 * 提交一次变更。
 * - 满足聚合条件（同键、时间窗内、当前节点是分支尖端且无子节点）时
 *   修改当前节点：拖动、滑块等连续调节合并为一步历史；
 * - 当前节点是分支尖端时追加子节点，延伸当前分支；
 * - 否则（撤销/跳转后在分支中段编辑）自动分出新分支，原分支保持可访问。
 */
export function commit(
  g: HistoryGraph,
  doc: LabDocument,
  label: string,
  context: NodeContext,
  options: CommitOptions,
  last: LastCommit | null,
  ids: IdGen = defaultIds,
): CommitResult {
  const branch = g.branches[g.current.branch];
  const atTip = branch.tip === g.current.node;
  if (
    options.key &&
    last &&
    last.key === options.key &&
    last.node === g.current.node &&
    options.now - last.at <= AGGREGATE_MS &&
    atTip &&
    childCount(g, g.current.node) === 0
  ) {
    const node: HistoryNode = { ...g.nodes[g.current.node], doc, label, context };
    return {
      graph: { ...g, nodes: { ...g.nodes, [node.id]: node } },
      last: { key: options.key, at: options.now, node: node.id },
      amended: true,
      forked: false,
    };
  }
  const node: HistoryNode = {
    id: ids(),
    parent: g.current.node,
    seq: g.seq + 1,
    label,
    doc,
    context,
  };
  let branches = g.branches;
  let current: HistoryGraph["current"];
  let forked = false;
  if (atTip) {
    branches = { ...branches, [branch.id]: { ...branch, tip: node.id } };
    current = { branch: branch.id, node: node.id };
  } else {
    const b: Branch = {
      id: ids(),
      name: nextBranchName(g.branches),
      tip: node.id,
      seq: g.seq + 1,
    };
    branches = { ...branches, [b.id]: b };
    current = { branch: b.id, node: node.id };
    forked = true;
  }
  const graph = prune({
    ...g,
    nodes: { ...g.nodes, [node.id]: node },
    branches,
    current,
    seq: g.seq + 1,
  });
  return {
    graph,
    last: options.key ? { key: options.key, at: options.now, node: node.id } : null,
    amended: false,
    forked,
  };
}

export function undo(g: HistoryGraph): HistoryGraph | null {
  const node = g.nodes[g.current.node];
  if (!node?.parent) return null;
  return { ...g, current: { ...g.current, node: node.parent } };
}

/** 重做沿当前分支路径向尖端走一步，分叉时不会走错分支 */
export function redo(g: HistoryGraph): HistoryGraph | null {
  const path = branchPath(g, g.current.branch);
  const i = path.findIndex((n) => n.id === g.current.node);
  if (i < 0 || i + 1 >= path.length) return null;
  return { ...g, current: { ...g.current, node: path[i + 1].id } };
}

/** 跳转到当前分支路径上的任意节点；不在路径上则拒绝 */
export function jumpTo(g: HistoryGraph, nodeId: string): HistoryGraph {
  const onPath = branchPath(g, g.current.branch).some((n) => n.id === nodeId);
  return onPath ? { ...g, current: { ...g.current, node: nodeId } } : g;
}

/** 从任意节点创建命名分支并切换过去；原分支的尖端不变 */
export function fork(
  g: HistoryGraph,
  nodeId: string,
  name?: string,
  ids: IdGen = defaultIds,
): HistoryGraph {
  if (!g.nodes[nodeId]) return g;
  const b: Branch = {
    id: ids(),
    name: name?.trim() || nextBranchName(g.branches),
    tip: nodeId,
    seq: g.seq + 1,
  };
  return {
    ...g,
    branches: { ...g.branches, [b.id]: b },
    current: { branch: b.id, node: nodeId },
    seq: g.seq + 1,
  };
}

export function checkout(g: HistoryGraph, branchId: string): HistoryGraph {
  const branch = g.branches[branchId];
  if (!branch) return g;
  return { ...g, current: { branch: branch.id, node: branch.tip } };
}

export function renameBranch(
  g: HistoryGraph,
  branchId: string,
  name: string,
): HistoryGraph {
  const branch = g.branches[branchId];
  const trimmed = name.trim();
  if (!branch || !trimmed) return g;
  const taken = new Set(
    Object.values(g.branches)
      .filter((b) => b.id !== branchId)
      .map((b) => b.name),
  );
  let unique = trimmed;
  for (let i = 2; taken.has(unique); i++) unique = `${trimmed} ${i}`;
  return {
    ...g,
    branches: { ...g.branches, [branchId]: { ...branch, name: unique } },
  };
}

/**
 * 删除分支。删除当前分支时确定性地回退到创建最早的分支尖端；
 * 仅被删除分支可达的节点被回收。最后一条分支不可删除。
 */
export function removeBranch(g: HistoryGraph, branchId: string): HistoryGraph {
  if (!g.branches[branchId] || Object.keys(g.branches).length <= 1) return g;
  const branches = { ...g.branches };
  delete branches[branchId];
  let current = g.current;
  if (current.branch === branchId) {
    const oldest = Object.values(branches).sort(
      (a, b) => a.seq - b.seq || a.id.localeCompare(b.id),
    )[0];
    current = { branch: oldest.id, node: oldest.tip };
  }
  return gc({ ...g, branches, current });
}

/** 回收从任何分支尖端都不可达的节点 */
export function gc(g: HistoryGraph): HistoryGraph {
  const reachable = new Set<string>();
  for (const b of Object.values(g.branches)) {
    let id: string | null = b.tip;
    while (id && !reachable.has(id)) {
      reachable.add(id);
      id = g.nodes[id]?.parent ?? null;
    }
  }
  const nodes: HistoryGraph["nodes"] = {};
  for (const id of reachable) nodes[id] = g.nodes[id];
  return { ...g, nodes };
}

/**
 * 节点数超限时压缩历史：折叠最古老且只有一个子节点的中段节点
 * （其子节点改为指向祖父节点）。当前节点、各分支尖端、分叉点
 * 都受保护；无候选时停止，宁可超限也不破坏分支结构。
 */
export function prune(g: HistoryGraph, max = MAX_NODES): HistoryGraph {
  for (;;) {
    if (Object.keys(g.nodes).length <= max) return g;
    const keep = new Set([
      g.current.node,
      ...Object.values(g.branches).map((b) => b.tip),
    ]);
    const candidate = Object.values(g.nodes)
      .filter((n) => !keep.has(n.id) && childCount(g, n.id) === 1)
      .sort((a, b) => a.seq - b.seq)[0];
    if (!candidate) return g;
    const nodes = { ...g.nodes };
    delete nodes[candidate.id];
    for (const n of Object.values(nodes)) {
      if (n.parent === candidate.id)
        nodes[n.id] = { ...n, parent: candidate.parent };
    }
    g = { ...g, nodes };
  }
}

const KEY_NAMES: Record<string, string> = {
  angle: "角度",
  size: "口径",
  power: "功率",
  rays: "光线数",
  spread: "发散角",
  wavelength: "波长",
  focal: "焦距",
  index: "折射率",
};

export function updateLabel(
  doc: LabDocument,
  id: string,
  patch: Partial<Element>,
): string {
  const e = doc.items.find((i) => i.id === id);
  const name = e ? labels[e.kind] : "器件";
  const keys = Object.keys(patch);
  if (keys.length > 0 && keys.every((k) => k === "x" || k === "y"))
    return `移动 ${name}`;
  return `调整 ${name}·${keys.map((k) => KEY_NAMES[k] ?? k).join("/")}`;
}

export interface NavigationTarget {
  mission: string;
  screen: string | null;
  selected: string | null;
}

/**
 * 导航到某节点时的确定性回退：
 * - 节点记录的任务未知 → 回退到默认任务；
 * - 节点记录的接收屏已不在该节点文档中（如撤销到删除接收屏之前）
 *   → 返回 null，由测量视图回退到该文档的第一块接收屏；
 * - 选中的器件不在文档中 → 清空选择。
 */
export function resolveNavigation(
  node: HistoryNode,
  knownMissions: string[],
  fallbackMission: string,
  selected: string | null,
): NavigationTarget {
  return {
    mission: knownMissions.includes(node.context.mission)
      ? node.context.mission
      : fallbackMission,
    screen:
      node.context.screen &&
      node.doc.items.some(
        (e) => e.id === node.context.screen && e.kind === "screen",
      )
        ? node.context.screen
        : null,
    selected:
      selected && node.doc.items.some((e) => e.id === selected)
        ? selected
        : null,
  };
}
