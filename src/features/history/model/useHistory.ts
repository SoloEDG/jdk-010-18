import { useRef, useState } from "react";
import type { Element, Kind, LabDocument } from "../../../shared/document";
import { labels } from "../../../shared/document";
import { patchDocument } from "../../../shared/commands";
import { createElement } from "../../catalog/model/catalog";
import { missions } from "../../missions/model/presets";
import {
  branchPath,
  checkout as graphCheckout,
  commit,
  createGraph,
  fork as graphFork,
  jumpTo as graphJumpTo,
  redo as graphRedo,
  removeBranch as graphRemoveBranch,
  renameBranch as graphRenameBranch,
  resolveNavigation,
  undo as graphUndo,
  updateLabel,
  type HistoryGraph,
  type LastCommit,
} from "./graph";
import {
  loadSession,
  saveSession,
  type Session,
  type SessionView,
} from "../lib/storage";

const KNOWN_MISSIONS = missions.map((m) => m.id);

export interface HistoryState extends Session {
  selected: string | null;
}

function initialState(): HistoryState & { restored: boolean } {
  const saved = loadSession(KNOWN_MISSIONS);
  if (saved) return { ...saved, selected: null, restored: true };
  return {
    graph: createGraph(missions[0].doc, {
      mission: KNOWN_MISSIONS[0],
      screen: null,
    }),
    view: { mission: KNOWN_MISSIONS[0], screen: null, resolution: 64 },
    selected: null,
    restored: false,
  };
}

export function useHistory() {
  const [state, setState] = useState(() => initialState());
  const [saved, setSaved] = useState(state.restored);
  const [event, setEvent] = useState("");
  const ref = useRef(state);
  ref.current = state;
  const last = useRef<LastCommit | null>(null);

  const { graph } = state;
  const node = graph.nodes[graph.current.node];
  const doc = node.doc;

  function commitDoc(
    next: LabDocument,
    label: string,
    options: {
      key?: string;
      selected?: string | null;
      view?: Partial<SessionView>;
    } = {},
  ) {
    const s = ref.current;
    const view = { ...s.view, ...options.view };
    const r = commit(
      s.graph,
      next,
      label,
      { mission: view.mission, screen: view.screen },
      { key: options.key, now: Date.now() },
      last.current,
    );
    last.current = r.last;
    if (r.forked)
      setEvent(
        `已从历史节点创建「${r.graph.branches[r.graph.current.branch].name}」，原分支不受影响`,
      );
    setState({
      ...s,
      graph: r.graph,
      view,
      selected: options.selected === undefined ? s.selected : options.selected,
    });
    setSaved(false);
  }

  /** 导航类操作（撤销/重做/跳转/切分支）共用的状态迁移 */
  function navigate(g: HistoryGraph) {
    const s = ref.current;
    const target = resolveNavigation(
      g.nodes[g.current.node],
      KNOWN_MISSIONS,
      KNOWN_MISSIONS[0],
      s.selected,
    );
    last.current = null;
    setState({
      ...s,
      graph: g,
      selected: target.selected,
      view: { ...s.view, mission: target.mission, screen: target.screen },
    });
    setSaved(false);
  }

  const path = branchPath(graph, graph.current.branch);

  return {
    doc,
    graph,
    path,
    currentNode: node,
    selected: state.selected,
    setSelected: (selected: string | null) =>
      setState({ ...ref.current, selected }),
    mission: state.view.mission,
    screen: state.view.screen,
    setScreen: (screen: string | null) => {
      setState({ ...ref.current, view: { ...ref.current.view, screen } });
      setSaved(false);
    },
    resolution: state.view.resolution,
    setResolution: (resolution: number) => {
      setState({ ...ref.current, view: { ...ref.current.view, resolution } });
      setSaved(false);
    },
    saved,
    event,
    dismissEvent: () => setEvent(""),

    add: (kind: Kind) => {
      const e = createElement(kind, doc.items.length);
      commitDoc({ ...doc, items: [...doc.items, e] }, `添加 ${labels[kind]}`, {
        selected: e.id,
      });
    },
    update: (id: string, patch: Partial<Element>) => {
      const keys = Object.keys(patch).sort().join(",");
      commitDoc(patchDocument(doc, id, patch), updateLabel(doc, id, patch), {
        key: `update:${id}:${keys}`,
      });
    },
    remove: (id: string) => {
      const e = doc.items.find((i) => i.id === id);
      commitDoc(
        { ...doc, items: doc.items.filter((i) => i.id !== id) },
        `移除 ${e ? labels[e.kind] : "器件"}`,
        { selected: null },
      );
    },
    chooseMission: (id: string) => {
      const m = missions.find((i) => i.id === id);
      if (!m) return;
      const reset = id === ref.current.view.mission;
      commitDoc(
        structuredClone(m.doc),
        reset ? `重置 · ${m.name}` : `切换任务 · ${m.name}`,
        { selected: null, view: { mission: id, screen: null } },
      );
    },

    undo: () => {
      const g = graphUndo(ref.current.graph);
      if (g) navigate(g);
    },
    redo: () => {
      const g = graphRedo(ref.current.graph);
      if (g) navigate(g);
    },
    canUndo: node.parent !== null,
    canRedo: graph.current.node !== graph.branches[graph.current.branch].tip,
    jumpTo: (nodeId: string) => {
      const g = graphJumpTo(ref.current.graph, nodeId);
      if (g !== ref.current.graph) navigate(g);
    },

    fork: (nodeId: string, name?: string) => {
      const g = graphFork(ref.current.graph, nodeId, name);
      if (g !== ref.current.graph) {
        setEvent(`已创建并切换到「${g.branches[g.current.branch].name}」`);
        navigate(g);
      }
    },
    checkout: (branchId: string) => {
      const g = graphCheckout(ref.current.graph, branchId);
      if (g !== ref.current.graph) navigate(g);
    },
    renameBranch: (branchId: string, name: string) => {
      const s = ref.current;
      setState({ ...s, graph: graphRenameBranch(s.graph, branchId, name) });
      setSaved(false);
    },
    removeBranch: (branchId: string) => {
      const s = ref.current;
      const g = graphRemoveBranch(s.graph, branchId);
      if (g === s.graph) return;
      if (s.graph.current.branch === branchId) {
        setEvent(
          `当前分支已删除，已切换到「${g.branches[g.current.branch].name}」`,
        );
        navigate(g);
      } else {
        setState({ ...s, graph: g });
        setSaved(false);
      }
    },

    save: () => {
      saveSession({ graph: ref.current.graph, view: ref.current.view });
      setSaved(true);
    },
  };
}

export type History = ReturnType<typeof useHistory>;
