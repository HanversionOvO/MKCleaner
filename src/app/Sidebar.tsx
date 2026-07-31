import { useState } from "react";
import type { EngineInfo } from "@/lib/ipc";
import { useUpdate } from "@/lib/updateStore";
import { AboutDialog } from "@/components/AboutDialog";
import {
  AnalyzeIcon,
  CleanIcon,
  OptimizeIcon,
  StatusIcon,
  TerminalIcon,
  UninstallIcon,
} from "./icons";

export type ViewId = "clean" | "optimize" | "analyze" | "status" | "uninstall" | "terminal";

const NAV: { id: ViewId; label: string; Icon: typeof CleanIcon }[] = [
  { id: "clean", label: "清理", Icon: CleanIcon },
  { id: "optimize", label: "优化", Icon: OptimizeIcon },
  { id: "analyze", label: "空间", Icon: AnalyzeIcon },
  { id: "status", label: "状态", Icon: StatusIcon },
  { id: "uninstall", label: "卸载", Icon: UninstallIcon },
  { id: "terminal", label: "终端", Icon: TerminalIcon },
];

type Props = {
  current: ViewId;
  onNavigate: (id: ViewId) => void;
  engine: EngineInfo | null;
};

export function Sidebar({ current, onNavigate, engine }: Props) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const update = useUpdate();

  return (
    <nav
      data-tauri-drag-region="deep"
      className="flex w-[212px] shrink-0 flex-col border-r border-hairline bg-glass backdrop-blur-[24px] backdrop-saturate-[1.6]"
      aria-label="主导航"
    >
      {/* Clears the traffic lights. The rest of the sidebar drags too — every
          part of it that is not a control. */}
      <div className="h-[52px] shrink-0" />

      <div className="flex flex-col gap-0.5 px-3">
        {NAV.map(({ id, label, Icon }) => {
          const active = id === current;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              aria-current={active ? "page" : undefined}
              className={[
                "flex items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left transition-colors",
                "duration-[var(--fast)] ease-[var(--ease)]",
                active
                  ? "bg-surface text-ink shadow-[0_0_0_1px_var(--hairline)]"
                  : "text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-ink",
              ].join(" ")}
            >
              <Icon className={active ? "text-clay" : "text-ink-faint"} />
              <span className="font-medium">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto px-3 pb-4 pt-6">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left text-ink-muted transition-colors duration-[var(--fast)] ease-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-ink"
        >
          <InfoIcon />
          <span className="font-medium">关于</span>
          {update.status === "available" && (
            <span
              className="ml-auto h-2 w-2 rounded-full bg-clay"
              title={`有可用更新 v${update.version}`}
              aria-label="有可用更新"
            />
          )}
        </button>
      </div>

      {aboutOpen && <AboutDialog engine={engine} onClose={() => setAboutOpen(false)} />}
    </nav>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 7.2v3.4M8 5.2v.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
