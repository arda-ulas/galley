const starterCode = `type Snapshot = {
  id: string;
  code: string;
  createdAt: string;
};

export function reconstructPast(snapshots: Snapshot[], index: number) {
  const snapshot = snapshots[index];

  if (!snapshot) {
    return "";
  }

  return snapshot.code;
}`;

export function EditorPlaceholder() {
  const lines = starterCode.split("\n");

  return (
    <div className="grid h-full min-h-0 grid-rows-[36px_1fr] bg-[var(--editor-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--panel-strong)] px-3">
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span className="size-2 rounded-full bg-[var(--presence-blue)]" />
          <span>room.ts</span>
        </div>
        <span className="text-xs text-[var(--muted)]">CodeMirror placeholder</span>
      </div>

      <div className="min-h-0 overflow-hidden p-4 font-mono text-[13px] leading-6">
        {lines.map((line, index) => (
          <div className="grid grid-cols-[3ch_1fr] gap-4" key={`${index}-${line}`}>
            <span className="select-none text-right text-[var(--editor-line)]">
              {index + 1}
            </span>
            <code className="whitespace-pre text-[var(--editor-text)]">{line}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
