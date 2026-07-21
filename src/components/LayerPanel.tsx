"use client";

import { Eye, EyeOff, ChevronUp, ChevronDown, Plus, Trash2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Layer } from "@/hooks/use-history";

export function LayerPanel({
  layers,
  activeLayerIdx,
  onSelectLayer,
  onAddLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onToggleVisibility,
  onMoveLayer,
  onCommit,
  onPointerEnter,
}: {
  layers: Layer[];
  activeLayerIdx: number;
  onSelectLayer: (idx: number) => void;
  onAddLayer: () => void;
  onDeleteLayer: (idx: number) => void;
  onDuplicateLayer: (idx: number) => void;
  onToggleVisibility: (idx: number) => void;
  onMoveLayer: (idx: number, dir: -1 | 1) => void;
  onCommit: () => void;
  onPointerEnter: () => void;
}) {
  const canAdd = layers.length < 5;

  const commit = (fn: () => void) => {
    fn();
    onCommit();
  };

  return (
    <div
      className="absolute z-40 flex flex-col gap-1.5 p-3 bg-card/80 backdrop-blur-lg border rounded-2xl shadow-2xl cursor-default
        bottom-12 left-1/2 -translate-x-1/2
        lg:bottom-1/2 lg:right-4 lg:left-auto lg:translate-x-0 lg:translate-y-1/2"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Layers
        </span>
        <button
          className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30"
          onClick={onAddLayer}
          disabled={!canAdd}
          title="Add layer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {[...layers].reverse().map((layer) => {
          const i = layers.indexOf(layer);
          const isFirst = i === 0;
          const isLast = i === layers.length - 1;

          return (
            <div
              key={layer.id}
              className={cn(
                "flex items-center gap-1 p-1.5 rounded-lg border transition-colors",
                i === activeLayerIdx
                  ? "bg-cyan-500/20 border-cyan-500/40"
                  : "bg-transparent border-transparent hover:bg-accent/50",
              )}
            >
              <button
                className={cn(
                  "inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-accent-foreground transition-colors",
                  !layer.visible && "opacity-40",
                )}
                onClick={() => onToggleVisibility(i)}
                title={layer.visible ? "Hide layer" : "Show layer"}
              >
                {layer.visible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                className="text-xs font-medium text-muted-foreground truncate hover:text-foreground min-w-[60px] text-left"
                onClick={() => onSelectLayer(i)}
                title={layer.name}
              >
                {layer.name}
              </button>

              <div className="flex items-center gap-0.5 ml-auto">
                <button
                  className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30"
                  onClick={() => commit(() => onDuplicateLayer(i))}
                  disabled={!canAdd}
                  title="Duplicate layer"
                >
                  <Copy className="w-3 h-3" />
                </button>

                <button
                  className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30"
                  onClick={() => commit(() => onDeleteLayer(i))}
                  disabled={isFirst}
                  title={isFirst ? "Cannot delete background layer" : "Delete layer"}
                >
                  <Trash2 className="w-3 h-3" />
                </button>

                <div className="flex flex-col -space-y-0.5">
                  <button
                    className="inline-flex items-center justify-center h-3 w-4 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-20"
                    onClick={() => onMoveLayer(i, 1)}
                    disabled={isLast}
                    title="Move layer up"
                  >
                    <ChevronUp className="w-2.5 h-2.5" />
                  </button>
                  <button
                    className="inline-flex items-center justify-center h-3 w-4 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-20"
                    onClick={() => onMoveLayer(i, -1)}
                    disabled={isFirst}
                    title="Move layer down"
                  >
                    <ChevronDown className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
