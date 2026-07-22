"use client";

import { useEffect, useRef, useState } from "react";

/** Inline-editable project title. Click to rename; Enter/blur commits, Escape
 *  cancels. Empty input keeps the previous name. The name drives normalized
 *  export/save file names (see `normalizeProjectFilename`). */
export function ProjectName({
  name,
  onChange,
}: {
  name: string;
  onChange: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing]);

  function startEdit() {
    setDraft(name);
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      onChange(trimmed);
    }
    setEditing(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="h-7 w-40 sm:w-52 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
        aria-label="Project name"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className="max-w-32 sm:max-w-52 truncate rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title="Click to rename project"
    >
      {name}
    </button>
  );
}
