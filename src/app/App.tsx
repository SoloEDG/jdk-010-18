import { useEffect, useMemo, useState } from "react";
import {
  Sun,
  Undo2,
  Redo2,
  Save,
  Grid2X2,
  MousePointer2,
  Move,
  Info,
  FlaskConical,
} from "lucide-react";
import { CatalogPanel, Inspector } from "../features/catalog";
import { Bench, ObjectList, DeviceGlyph } from "../features/bench";
import { useOptics, RayLayer, OpticsControls } from "../features/optics";
import { trace } from "../features/optics/lib/trace";
import { DetectorPanel, measure } from "../features/detector";
import { missions, evaluateMission, MissionPanel } from "../features/missions";
import { useHistory, HistoryPanel, CompareBar } from "../features/history";

export function App() {
  const history = useHistory();
  const doc = history.doc;
  const optics = useOptics(doc);
  const screens = useMemo(
    () => doc.items.filter((e) => e.kind === "screen"),
    [doc],
  );
  // 确定性回退：所选接收屏不在当前文档时，回退到第一块接收屏
  const screen = screens.find((s) => s.id === history.screen) ?? screens[0];
  const measurement = useMemo(
    () => measure(screen, optics.result.hits, history.resolution),
    [screen, optics.result, history.resolution],
  );
  const mission =
    missions.find((m) => m.id === history.mission) ?? missions[0];
  const evaluation = evaluateMission(mission.id, doc, optics.result);

  const [grid, setGrid] = useState(true);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("");
  const [compareId, setCompareId] = useState<string | null>(null);

  const branches = useMemo(
    () => Object.values(history.graph.branches).sort((a, b) => a.seq - b.seq),
    [history.graph.branches],
  );
  const currentBranch = history.graph.current.branch;

  // 比较模式的参考分支：只读取其快照做追迹与测量，绝不写回当前场景
  const refBranch = compareId ? history.graph.branches[compareId] : undefined;
  const refNode = refBranch ? history.graph.nodes[refBranch.tip] : undefined;
  const refResult = useMemo(
    () => (refNode ? trace(refNode.doc) : null),
    [refNode],
  );
  const refScreen = useMemo(() => {
    if (!refNode) return undefined;
    const list = refNode.doc.items.filter((e) => e.kind === "screen");
    return list.find((s) => s.id === refNode.context.screen) ?? list[0];
  }, [refNode]);
  const refMeasurement = useMemo(
    () =>
      refNode && refResult
        ? measure(refScreen, refResult.hits, history.resolution)
        : null,
    [refNode, refResult, refScreen, history.resolution],
  );

  // 参考分支被删除或变为当前分支时，确定性地退出比较
  useEffect(() => {
    if (
      compareId &&
      (!history.graph.branches[compareId] || compareId === currentBranch)
    )
      setCompareId(null);
  }, [compareId, history.graph, currentBranch]);

  const event = history.event;
  useEffect(() => {
    if (event) {
      setNotice(event);
      history.dismissEvent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  const selected = doc.items.find((e) => e.id === history.selected);
  return (
    <div className="app-shell">
      <header>
        <a className="brand" href="./">
          <span className="brand-mark">
            <Sun size={23} />
          </span>
          LUMEN
          <span className="brand-divider" />
          <small>光学实验室</small>
        </a>
        <div className="document-title">
          {history.graph.branches[currentBranch]?.name ?? "未命名实验"}{" "}
          <span>本地工作区</span>
        </div>
        <div className="header-actions">
          <button
            title="撤销"
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            title="重做"
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <Redo2 size={17} />
          </button>
          <i />
          <button
            className="save-button"
            onClick={() => {
              try {
                history.save();
                setNotice("实验已保存到此浏览器");
              } catch {
                setNotice("保存失败，浏览器存储空间不足");
              }
            }}
          >
            <Save size={15} />
            {history.saved ? "已保存" : "保存实验"}
          </button>
        </div>
      </header>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">THE OPTICS PLAYGROUND</span>
          <h1>
            让光的路径，清晰可见<span>。</span>
          </h1>
        </div>
        <p>
          <i />
          二维几何光学 · 实时模拟
        </p>
      </div>
      <main>
        <aside className="left-sidebar">
          <CatalogPanel
            onAdd={(kind) => {
              if (doc.items.length >= 80) {
                setNotice("场景最多容纳 80 个器件");
                return;
              }
              history.add(kind);
            }}
          />
          <ObjectList
            doc={doc}
            selected={history.selected}
            onSelect={history.setSelected}
          />
          <HistoryPanel
            branches={branches}
            path={history.path}
            currentBranch={currentBranch}
            currentNode={history.graph.current.node}
            comparing={compareId}
            onCheckout={history.checkout}
            onFork={(nodeId) => history.fork(nodeId)}
            onRename={history.renameBranch}
            onRemove={history.removeBranch}
            onCompare={setCompareId}
            onJump={history.jumpTo}
          />
        </aside>
        <div className="center">
          {compareId && refBranch && refNode && refResult && refMeasurement && (
            <CompareBar
              branches={branches}
              currentBranch={currentBranch}
              reference={compareId}
              current={measurement}
              referenceMeasurement={refMeasurement}
              onReference={setCompareId}
              onAdopt={() => {
                history.checkout(compareId);
                setCompareId(null);
                setNotice(`已切换到「${refBranch.name}」`);
              }}
              onExit={() => setCompareId(null)}
            />
          )}
          <section className="canvas-panel">
            <div className="canvas-toolbar">
              <div className="canvas-label">
                <FlaskConical size={15} />
                实验台<span>LIVE</span>
              </div>
              <div className="canvas-tools">
                <OpticsControls
                  visible={optics.visible}
                  normals={optics.normals}
                  onVisible={() => optics.setVisible(!optics.visible)}
                  onNormals={() => optics.setNormals(!optics.normals)}
                />
                <button
                  className={grid ? "enabled" : ""}
                  title="切换网格"
                  onClick={() => setGrid(!grid)}
                >
                  <Grid2X2 size={15} />
                </button>
              </div>
            </div>
            <div className="canvas-container">
              <Bench
                doc={doc}
                selected={history.selected}
                onSelect={history.setSelected}
                onUpdate={history.update}
                grid={grid}
              >
                <RayLayer
                  doc={doc}
                  result={optics.result}
                  visible={optics.visible}
                  normals={optics.normals}
                />
                {refNode && refResult && (
                  <g opacity={0.45} pointerEvents="none">
                    {refNode.doc.items.map((e) => (
                      <DeviceGlyph key={e.id} e={e} selected={false} />
                    ))}
                    <RayLayer
                      doc={refNode.doc}
                      result={refResult}
                      visible={optics.visible}
                      normals={false}
                      dashed
                    />
                  </g>
                )}
              </Bench>
              <div className="canvas-badge">
                <MousePointer2 size={13} />
                选择与拖动
              </div>
              <div className="scale">
                ━━━━ <span>100 mm</span>
              </div>
            </div>
            <div className="canvas-footer">
              <span>
                <Move size={12} />
                拖动移动器件 <i />
                方向键微调
              </span>
              <span>
                {optics.result.segments.length} 段光路 · {doc.items.length}{" "}
                个器件
              </span>
            </div>
          </section>
          <DetectorPanel
            screens={screens}
            screen={screen}
            measurement={measurement}
            onChoose={history.setScreen}
            resolution={history.resolution}
            onResolution={history.setResolution}
          />
        </div>
        <aside className="right-sidebar">
          <Inspector
            element={selected}
            onUpdate={(p) => selected && history.update(selected.id, p)}
            onRemove={() => selected && history.remove(selected.id)}
          />
          <MissionPanel
            mission={mission}
            evaluation={evaluation}
            onChoose={history.chooseMission}
          />
        </aside>
      </main>
      <footer>
        <span>
          <i />
          光路计算已更新
          {optics.result.truncated > 0 ? " · 部分光线达到追迹上限" : ""}
        </span>
        <span>{notice || "所有实验数据保存在你的浏览器中"}</span>
        <button onClick={() => setHelp(!help)}>
          <Info size={13} />
          使用指南
        </button>
      </footer>
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section className="help-modal" onClick={(e) => e.stopPropagation()}>
            <span className="eyebrow">QUICK START</span>
            <h2>在光的世界里动手探索</h2>
            <p>1. 点击左侧器件添加到实验台。</p>
            <p>2. 拖动器件改变位置；右侧调整角度、焦距与波长。</p>
            <p>3. 光线遇到接收屏后终止，底部实时显示命中能量与光斑半径。</p>
            <p>
              4.
              选择实验任务，达到测量条件时自动完成。保存实验后，刷新可恢复器件布局。
            </p>
            <p>
              5.
              历史面板中可从任意节点创建命名分支，比较两条分支的光路与接收屏测量后再决定采用哪条。
            </p>
            <p className="muted">
              透镜采用近轴薄透镜模型。棱镜使用带色散的 Snell
              折射；每条光线最多追迹 32 次。
            </p>
            <button className="save-button" onClick={() => setHelp(false)}>
              开始探索
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
