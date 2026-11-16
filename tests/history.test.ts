import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGGREGATE_MS,
  branchPath,
  checkout,
  commit,
  createGraph,
  fork,
  jumpTo,
  prune,
  redo,
  removeBranch,
  renameBranch,
  resolveNavigation,
  undo,
  updateLabel,
  type HistoryGraph,
  type LastCommit,
  type NodeContext,
} from "../src/features/history/model/graph";
import {
  parseSession,
  serializeSession,
  validDocument,
} from "../src/features/history/lib/storage";
import { missions } from "../src/features/missions/model/presets";
import type { LabDocument } from "../src/shared/document";

let n = 0;
const ids = () => `id-${++n}`;
const KNOWN = missions.map((m) => m.id);
const ctx: NodeContext = { mission: "focus", screen: null };

function doc(tag: number): LabDocument {
  return {
    version: 1,
    items: [
      {
        id: `e${tag}`,
        kind: "screen",
        x: 100 + tag,
        y: 300,
        angle: 90,
        size: 180,
        power: 1,
        rays: 9,
        spread: 0,
        wavelength: 550,
        focal: 180,
        index: 1.52,
      },
    ],
  };
}

const cur = (g: HistoryGraph) => g.nodes[g.current.node];

/** 依次提交 count 个无聚合键的节点，返回新图 */
function chain(g: HistoryGraph, count: number): HistoryGraph {
  let last: LastCommit | null = null;
  for (let i = 1; i <= count; i++) {
    const r = commit(g, doc(i), `c${i}`, ctx, { now: i * 10000 }, last, ids);
    g = r.graph;
    last = r.last;
  }
  return g;
}

test("undo/redo walks the current branch path", () => {
  let g = chain(createGraph(doc(0), ctx, "root", ids), 3);
  assert.equal(cur(g).label, "c3");
  g = undo(g)!;
  assert.equal(cur(g).label, "c2");
  g = undo(g)!;
  g = undo(g)!;
  assert.equal(cur(g).label, "root");
  assert.equal(undo(g), null);
  g = redo(g)!;
  assert.equal(cur(g).label, "c1");
  g = redo(g)!;
  g = redo(g)!;
  assert.equal(cur(g).label, "c3");
  assert.equal(redo(g), null);
});

test("continuous updates aggregate within the time window", () => {
  let g = createGraph(doc(0), ctx, "root", ids);
  const d1 = doc(1);
  const c1 = commit(g, d1, "调整 凸透镜·焦距", ctx, { key: "u:lens:focal", now: 1000 }, null, ids);
  g = c1.graph;
  const d2 = doc(2);
  const c2 = commit(g, d2, "调整 凸透镜·焦距", ctx, { key: "u:lens:focal", now: 1000 + AGGREGATE_MS - 1 }, c1.last, ids);
  assert.equal(c2.amended, true);
  assert.equal(Object.keys(c2.graph.nodes).length, 2);
  assert.equal(cur(c2.graph).doc, d2);
  const c3 = commit(c2.graph, doc(3), "调整 凸透镜·焦距", ctx, { key: "u:lens:focal", now: 1000 + 2 * AGGREGATE_MS }, c2.last, ids);
  assert.equal(c3.amended, false);
  assert.equal(Object.keys(c3.graph.nodes).length, 3);
});

test("boundary operations break the aggregation chain", () => {
  let g = createGraph(doc(0), ctx, "root", ids);
  const c1 = commit(g, doc(1), "调整 凸透镜·焦距", ctx, { key: "u:lens:focal", now: 0 }, null, ids);
  const boundary = commit(c1.graph, doc(2), "移除 平面镜", ctx, { now: 100 }, c1.last, ids);
  assert.equal(boundary.last, null);
  const c2 = commit(boundary.graph, doc(3), "调整 凸透镜·焦距", ctx, { key: "u:lens:focal", now: 200 }, boundary.last, ids);
  assert.equal(c2.amended, false);
  assert.equal(Object.keys(c2.graph.nodes).length, 4);
});

test("editing from a mid-branch node auto-forks and keeps the original branch", () => {
  let g = chain(createGraph(doc(0), ctx, "root", ids), 3);
  const mainId = g.current.branch;
  const mainTip = g.branches[mainId].tip;
  g = undo(undo(g)!)!;
  assert.equal(cur(g).label, "c1");
  const r = commit(g, doc(9), "c4", ctx, { now: 99999 }, null, ids);
  assert.equal(r.forked, true);
  const g2 = r.graph;
  assert.equal(Object.keys(g2.branches).length, 2);
  assert.equal(g2.branches[mainId].tip, mainTip, "原分支尖端不变");
  assert.equal(cur(g2).label, "c4");
  assert.equal(g2.nodes[g2.current.node].parent, branchPath(g2, mainId)[1].id);
  // 重做沿新分支路径走，不会回到主分支的 c2
  const g3 = undo(g2)!;
  assert.equal(cur(g3).label, "c1");
  assert.equal(cur(redo(g3)!).label, "c4");
  // 切回原分支仍可达 c3
  const g4 = checkout(g2, mainId);
  assert.equal(cur(g4).label, "c3");
});

test("fork, rename and deterministic fallback when deleting the current branch", () => {
  let g = chain(createGraph(doc(0), ctx, "root", ids), 2);
  const c1 = branchPath(g, g.current.branch)[1];
  g = fork(g, c1.id, "对照组", ids);
  assert.equal(g.branches[g.current.branch].name, "对照组");
  assert.equal(g.current.node, c1.id);
  const r = commit(g, doc(7), "f1", ctx, { now: 1 }, null, ids);
  assert.equal(r.forked, false, "在新分支尖端提交应延伸该分支");
  g = r.graph;
  g = renameBranch(g, g.current.branch, "  方案 B  ");
  assert.equal(g.branches[g.current.branch].name, "方案 B");
  g = renameBranch(g, g.current.branch, "主分支");
  assert.equal(g.branches[g.current.branch].name, "主分支 2", "重名自动加序号");
  g = removeBranch(g, g.current.branch);
  assert.equal(g.branches[g.current.branch].name, "主分支", "回退到创建最早的分支");
  assert.equal(cur(g).label, "c2");
  assert.ok(!Object.values(g.nodes).some((x) => x.label === "f1"), "不可达节点被回收");
  assert.ok(Object.values(g.nodes).some((x) => x.label === "c1"));
  assert.equal(removeBranch(g, g.current.branch), g, "最后一条分支不可删除");
});

test("jumpTo only follows the current branch path", () => {
  let g = chain(createGraph(doc(0), ctx, "root", ids), 2);
  const [root, c1] = branchPath(g, g.current.branch);
  g = jumpTo(g, c1.id);
  assert.equal(g.current.node, c1.id);
  const g2 = fork(g, root.id, "B", ids);
  assert.equal(jumpTo(g2, c1.id), g2, "其他分支的节点不可跳转");
});

test("prune squashes oldest mid-chain nodes but protects tips and fork points", () => {
  const g = chain(createGraph(doc(0), ctx, "root", ids), 6);
  const p = prune(g, 4);
  assert.ok(Object.keys(p.nodes).length <= 4);
  const path = branchPath(p, p.current.branch);
  assert.equal(path.at(-1)!.label, "c6");
  assert.equal(path[0].parent, null);
  assert.equal(cur(p).label, "c6");

  let g2 = chain(createGraph(doc(0), ctx, "root", ids), 2);
  const c1 = branchPath(g2, g2.current.branch)[1];
  g2 = fork(g2, c1.id, undefined, ids);
  g2 = commit(g2, doc(5), "b1", ctx, { now: 1 }, null, ids).graph;
  const p2 = prune(g2, 3);
  assert.ok(p2.nodes[c1.id], "分叉点受保护");
  assert.equal(Object.values(p2.nodes).filter((x) => x.parent === c1.id).length, 2);
});

test("aggregation never rewrites a node that has children", () => {
  let g = createGraph(doc(0), ctx, "root", ids);
  const d1 = doc(1);
  const u1 = commit(g, d1, "调整 凸透镜·焦距", ctx, { key: "k", now: 0 }, null, ids);
  g = u1.graph;
  const a = g.current.node;
  const mainId = g.current.branch;
  g = fork(g, a, undefined, ids);
  g = commit(g, doc(2), "b1", ctx, { now: 10 }, null, ids).graph;
  g = checkout(g, mainId);
  const u2 = commit(g, doc(3), "调整 凸透镜·焦距", ctx, { key: "k", now: 100 }, u1.last, ids);
  assert.equal(u2.amended, false, "已有子节点的分叉点不可被改写");
  assert.equal(u2.graph.nodes[a].doc, d1);
});

test("aggregation does not leak across navigation", () => {
  const g = createGraph(doc(0), ctx, "root", ids);
  const c1 = commit(g, doc(1), "u", ctx, { key: "k", now: 0 }, null, ids);
  const back = undo(c1.graph)!;
  const c2 = commit(back, doc(2), "u", ctx, { key: "k", now: 100 }, c1.last, ids);
  assert.equal(c2.amended, false);
  assert.equal(c2.forked, true, "撤销后编辑应自动创建分支");
});

test("session round-trip preserves device identity and task context", () => {
  const screen = missions[1].doc.items.find((e) => e.kind === "screen")!;
  let g = createGraph(missions[0].doc, { mission: "focus", screen: null }, "初始", ids);
  const r = commit(
    g,
    missions[1].doc,
    "切换任务 · 转折的光",
    { mission: "reflection", screen: screen.id },
    { now: 1 },
    null,
    ids,
  );
  g = fork(r.graph, r.graph.current.node, "方案 A", ids);
  const session = {
    graph: g,
    view: { mission: "reflection", screen: screen.id, resolution: 128 },
  };
  const restored = parseSession(serializeSession(session), KNOWN);
  assert.deepEqual(restored?.graph, g);
  assert.deepEqual(restored?.view, session.view);
  const node = restored!.graph.nodes[restored!.graph.current.node];
  assert.equal(node.context.mission, "reflection");
  assert.equal(node.context.screen, screen.id);
  assert.ok(node.doc.items.some((e) => e.id === screen.id), "器件 id 在重开后保持");
});

test("session validation rejects corrupted payloads", () => {
  assert.equal(parseSession("not json", KNOWN), null);
  assert.equal(parseSession(JSON.stringify({ version: 1 }), KNOWN), null);
  const g = createGraph(doc(0), ctx, "root", ids);
  const ok = { graph: g, view: { mission: "focus", screen: null, resolution: 64 } };
  assert.ok(parseSession(serializeSession(ok), KNOWN));
  const tampered = JSON.parse(serializeSession(ok));
  tampered.graph.branches[g.current.branch].tip = "missing";
  assert.equal(parseSession(JSON.stringify(tampered), KNOWN), null);
  const cycled = JSON.parse(serializeSession(ok));
  const rootId = g.current.node;
  cycled.graph.nodes[rootId].parent = rootId;
  assert.equal(parseSession(JSON.stringify(cycled), KNOWN), null, "拒绝成环的节点链");
});

test("validDocument enforces element invariants", () => {
  assert.ok(validDocument(missions[0].doc));
  const bad = doc(1);
  bad.items[0].rays = 0;
  assert.equal(validDocument(bad), null);
  assert.equal(validDocument({ version: 1, items: [{ kind: "laser" }] }), null);
});

test("navigation fallback is deterministic when context is missing", () => {
  const withScreen = missions[0].doc;
  const screenId = withScreen.items.find((e) => e.kind === "screen")!.id;
  const node = {
    id: "n",
    parent: null,
    seq: 1,
    label: "x",
    doc: withScreen,
    context: { mission: "unknown-mission", screen: "deleted-screen" },
  };
  const nav = resolveNavigation(node, KNOWN, KNOWN[0], "kept?");
  assert.equal(nav.mission, KNOWN[0]);
  assert.equal(nav.screen, null, "节点里没有该接收屏时回退为空");
  assert.equal(nav.selected, null);
  const ok = resolveNavigation(
    { ...node, context: { mission: "reflection", screen: screenId } },
    KNOWN,
    KNOWN[0],
    screenId,
  );
  assert.equal(ok.mission, "reflection");
  assert.equal(ok.screen, screenId);
  assert.equal(ok.selected, screenId, "选中器件仍在文档中时保留选择");
});

test("update labels describe the operation", () => {
  const d = missions[0].doc;
  assert.equal(updateLabel(d, "lens", { x: 500, y: 300 }), "移动 凸透镜");
  assert.equal(updateLabel(d, "lens", { focal: 200 }), "调整 凸透镜·焦距");
  assert.equal(updateLabel(d, "missing", { angle: 10 }), "调整 器件·角度");
});
