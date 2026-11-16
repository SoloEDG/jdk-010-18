import type { LabDocument } from "../../../shared/document";
import {
  createGraph,
  gc,
  type HistoryGraph,
  type HistoryNode,
} from "../model/graph";

export const STORAGE_KEY = "lumen-history";
const LEGACY_KEY = "lumen-document";
/** 反损坏上限，远大于运行时 MAX_NODES */
const MAX_STORED_NODES = 400;

export interface SessionView {
  /** 当前任务 id（提交节点时也会快照进节点上下文） */
  mission: string;
  /** 当前选中的接收屏器件 id */
  screen: string | null;
  resolution: number;
}

export interface Session {
  graph: HistoryGraph;
  view: SessionView;
}

export function validDocument(v: unknown): LabDocument | null {
  if (!v || typeof v !== "object") return null;
  const d = v as LabDocument;
  if (d.version !== 1 || !Array.isArray(d.items) || d.items.length > 80)
    return null;
  for (const e of d.items) {
    if (
      !["source", "mirror", "lens", "prism", "screen"].includes(e?.kind) ||
      typeof e.id !== "string"
    )
      return null;
    for (const k of [
      "x",
      "y",
      "angle",
      "size",
      "power",
      "rays",
      "spread",
      "wavelength",
      "focal",
      "index",
    ])
      if (!Number.isFinite(e[k as keyof typeof e])) return null;
    if (e.rays < 1 || e.rays > 41 || e.size <= 0 || e.focal === 0 || e.index < 1)
      return null;
  }
  return d;
}

export function serializeSession(s: Session): string {
  return JSON.stringify({ version: 2, ...s });
}

export function parseSession(
  json: string,
  knownMissions: string[],
): Session | null {
  try {
    return validateSession(JSON.parse(json), knownMissions);
  } catch {
    return null;
  }
}

function validNode(v: unknown): HistoryNode | null {
  const n = v as HistoryNode;
  if (!n || typeof n !== "object") return null;
  if (
    typeof n.id !== "string" ||
    !(n.parent === null || typeof n.parent === "string") ||
    typeof n.label !== "string" ||
    !Number.isFinite(n.seq)
  )
    return null;
  if (!validDocument(n.doc)) return null;
  const c = n.context;
  if (
    !c ||
    typeof c.mission !== "string" ||
    !(c.screen === null || typeof c.screen === "string")
  )
    return null;
  return n;
}

function validateSession(v: unknown, knownMissions: string[]): Session | null {
  const s = v as { version?: number; graph?: HistoryGraph; view?: SessionView };
  if (s?.version !== 2 || !s.graph || typeof s.graph !== "object") return null;
  const g = s.graph;
  if (!g.nodes || !g.branches || !g.current) return null;
  const nodeList = Object.values(g.nodes);
  if (!nodeList.length || nodeList.length > MAX_STORED_NODES) return null;
  for (const n of nodeList) if (!validNode(n)) return null;
  for (const n of nodeList) if (n.parent && !g.nodes[n.parent]) return null;
  const branchList = Object.values(g.branches);
  if (!branchList.length) return null;
  for (const b of branchList) {
    if (
      !b ||
      typeof b.id !== "string" ||
      typeof b.name !== "string" ||
      !g.nodes[b.tip] ||
      !Number.isFinite(b.seq)
    )
      return null;
  }
  if (!g.branches[g.current.branch] || !g.nodes[g.current.node]) return null;
  if (!Number.isFinite(g.seq)) return null;
  // 每条分支路径必须无环地走到根，且 current.node 位于当前分支路径上
  for (const b of branchList) {
    const seen = new Set<string>();
    let id: string | null = b.tip;
    let foundCurrent = false;
    while (id) {
      if (seen.has(id)) return null;
      seen.add(id);
      if (b.id === g.current.branch && id === g.current.node)
        foundCurrent = true;
      id = g.nodes[id]?.parent ?? null;
    }
    if (b.id === g.current.branch && !foundCurrent) return null;
  }
  const view = s.view;
  return {
    graph: gc(g),
    view: {
      mission:
        view && knownMissions.includes(view.mission)
          ? view.mission
          : knownMissions[0],
      screen: view && typeof view.screen === "string" ? view.screen : null,
      resolution:
        view && [32, 64, 128].includes(view.resolution) ? view.resolution : 64,
    },
  };
}

export function saveSession(s: Session) {
  localStorage.setItem(STORAGE_KEY, serializeSession(s));
}

export function loadSession(knownMissions: string[]): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = parseSession(raw, knownMissions);
      if (s) return s;
    }
    // 兼容 v1：旧的单文档存档迁移为单节点历史，器件 id 原样保留
    const legacy = validDocument(
      JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null"),
    );
    if (legacy)
      return {
        graph: createGraph(legacy, {
          mission: knownMissions[0],
          screen: null,
        }),
        view: { mission: knownMissions[0], screen: null, resolution: 64 },
      };
    return null;
  } catch {
    return null;
  }
}
