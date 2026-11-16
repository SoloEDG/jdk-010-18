import { GitCompare, Check, X } from "lucide-react";
import type { Measurement } from "../../detector/lib/measurement";
import type { Branch } from "../model/graph";

function Metrics({ m, tone }: { m: Measurement; tone: string }) {
  return (
    <span className={"compare-metrics " + tone}>
      <b>{m.energy.toFixed(3)} W</b>
      <span>RMS {m.spread.toFixed(2)} mm</span>
      <span>{m.count} 条</span>
    </span>
  );
}

export function CompareBar({
  branches,
  currentBranch,
  reference,
  current,
  referenceMeasurement,
  onReference,
  onAdopt,
  onExit,
}: {
  branches: Branch[];
  currentBranch: string;
  reference: string;
  current: Measurement;
  referenceMeasurement: Measurement;
  onReference: (id: string) => void;
  onAdopt: () => void;
  onExit: () => void;
}) {
  const currentName = branches.find((b) => b.id === currentBranch)?.name ?? "";
  const delta = referenceMeasurement.energy - current.energy;
  return (
    <div className="compare-bar" role="region" aria-label="分支比较">
      <span className="compare-tag">
        <GitCompare size={13} />
        比较模式
      </span>
      <div className="compare-side">
        <span className="compare-name current">当前 · {currentName}</span>
        <Metrics m={current} tone="current" />
      </div>
      <div className="compare-side">
        <span className="compare-name reference">
          参考 ·
          <select
            aria-label="参考分支"
            value={reference}
            onChange={(e) => onReference(e.target.value)}
          >
            {branches
              .filter((b) => b.id !== currentBranch)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </span>
        <Metrics m={referenceMeasurement} tone="reference" />
        <span
          className={
            "compare-delta" + (delta >= 0 ? " positive" : " negative")
          }
          title="参考分支接收能量 − 当前分支接收能量"
        >
          Δ {delta >= 0 ? "+" : ""}
          {delta.toFixed(3)} W
        </span>
      </div>
      <span className="compare-actions">
        <button className="adopt" onClick={onAdopt}>
          <Check size={13} />
          采用参考分支
        </button>
        <button onClick={onExit} title="退出比较，不改变当前实验">
          <X size={13} />
          退出
        </button>
      </span>
    </div>
  );
}
