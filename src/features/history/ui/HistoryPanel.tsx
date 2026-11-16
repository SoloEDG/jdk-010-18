import { useState } from "react";
import {
  GitBranch,
  GitCompare,
  GitFork,
  Pencil,
  Trash2,
  History,
} from "lucide-react";
import type { Branch, HistoryNode } from "../model/graph";

export function HistoryPanel({
  branches,
  path,
  currentBranch,
  currentNode,
  comparing,
  onCheckout,
  onFork,
  onRename,
  onRemove,
  onCompare,
  onJump,
}: {
  branches: Branch[];
  path: HistoryNode[];
  currentBranch: string;
  currentNode: string;
  comparing: string | null;
  onCheckout: (id: string) => void;
  onFork: (nodeId: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onCompare: (id: string) => void;
  onJump: (nodeId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const currentIndex = path.findIndex((n) => n.id === currentNode);
  const tip = path.at(-1)?.id;

  function submitRename(id: string) {
    onRename(id, draft);
    setEditing(null);
  }

  return (
    <section className="history-panel">
      <div className="section-title">
        历史与分支 <History size={14} />
      </div>
      <div className="branch-list">
        {branches.map((b) => (
          <div
            key={b.id}
            className={
              "branch-row" +
              (b.id === currentBranch ? " active" : "") +
              (b.id === comparing ? " comparing" : "")
            }
          >
            {editing === b.id ? (
              <input
                className="branch-rename"
                aria-label="分支名称"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => submitRename(b.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename(b.id);
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <button
                className="branch-name"
                title={`切换到「${b.name}」`}
                onClick={() => onCheckout(b.id)}
              >
                <GitBranch size={12} />
                <span>{b.name}</span>
              </button>
            )}
            <span className="branch-actions">
              <button
                title="重命名分支"
                aria-label={`重命名 ${b.name}`}
                onClick={() => {
                  setDraft(b.name);
                  setEditing(b.id);
                }}
              >
                <Pencil size={11} />
              </button>
              <button
                title={
                  b.id === currentBranch
                    ? "当前分支"
                    : `与「${b.name}」比较光路与屏测量`
                }
                aria-label={`比较 ${b.name}`}
                disabled={b.id === currentBranch}
                onClick={() => onCompare(b.id)}
              >
                <GitCompare size={11} />
              </button>
              <button
                title={
                  branches.length <= 1 ? "至少保留一条分支" : `删除「${b.name}」`
                }
                aria-label={`删除 ${b.name}`}
                disabled={branches.length <= 1}
                onClick={() => onRemove(b.id)}
              >
                <Trash2 size={11} />
              </button>
            </span>
          </div>
        ))}
      </div>
      <button className="new-branch" onClick={() => onFork(currentNode)}>
        <GitFork size={12} />
        从当前节点新建分支
      </button>
      <div className="timeline" role="list" aria-label="当前分支历史">
        {path.map((n, i) => (
          <div
            key={n.id}
            role="listitem"
            className={
              "node-row" +
              (n.id === currentNode ? " current" : "") +
              (i > currentIndex ? " future" : "")
            }
          >
            <button
              className="node-label"
              title={`跳转到：${n.label}`}
              onClick={() => onJump(n.id)}
            >
              <i />
              <span>{n.label}</span>
              {n.id === tip && <em>最新</em>}
            </button>
            <button
              className="node-fork"
              title="在此节点创建分支"
              aria-label={`从「${n.label}」创建分支`}
              onClick={() => onFork(n.id)}
            >
              <GitFork size={10} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
