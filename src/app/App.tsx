import { useEffect, useState } from "react";
import { engineInfo, onTrayNavigate, onTrayScan, type EngineInfo } from "@/lib/ipc";
import { checkForUpdates } from "@/lib/updateStore";
import { FdaBanner } from "@/components/FdaBanner";
import { startScan } from "@/features/clean/store";
import { Sidebar, type ViewId } from "./Sidebar";
import { CleanView } from "@/features/clean/CleanView";
import { OptimizeView } from "@/features/optimize/OptimizeView";
import { AnalyzeView } from "@/features/analyze/AnalyzeView";
import { StatusView } from "@/features/status/StatusView";
import { UninstallView } from "@/features/uninstall/UninstallView";
import { TerminalView } from "@/features/terminal/TerminalView";

type EngineState =
  | { status: "checking" }
  | { status: "ready"; info: EngineInfo }
  | { status: "failed"; message: string };

export default function App() {
  const [view, setView] = useState<ViewId>("clean");
  const [engine, setEngine] = useState<EngineState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    engineInfo()
      .then((info) => !cancelled && setEngine({ status: "ready", info }))
      .catch((e) => !cancelled && setEngine({ status: "failed", message: String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Check for updates every time the app opens.
  useEffect(() => {
    void checkForUpdates();
  }, []);

  // The tray's "开始扫描" item jumps here and starts a scan.
  useEffect(() => {
    const off = onTrayScan(() => {
      setView("clean");
      void startScan();
    });
    return () => {
      off.then((unlisten) => unlisten());
    };
  }, []);

  // The tray's view items jump to their tab.
  useEffect(() => {
    const off = onTrayNavigate((view) => {
      if (view === "clean" || view === "optimize" || view === "analyze" || view === "status" || view === "uninstall" || view === "terminal") {
        setView(view);
      }
    });
    return () => {
      off.then((unlisten) => unlisten());
    };
  }, []);

  if (engine.status === "failed") {
    return <EngineFailure message={engine.message} />;
  }

  return (
    <div className="flex h-full">
      <Sidebar
        current={view}
        onNavigate={setView}
        engine={engine.status === "ready" ? engine.info : null}
      />
      {/* Keying the view replays a quiet fade on every tab change — enough to
          connect the transition, not enough to feel busy. */}
      <main key={view} className="fade-in flex min-w-0 flex-1 flex-col">
        <div className="px-9 pt-5">
          <FdaBanner />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {view === "clean" && <CleanView />}
          {view === "optimize" && <OptimizeView />}
          {view === "analyze" && <AnalyzeView />}
          {view === "status" && <StatusView />}
          {view === "uninstall" && <UninstallView />}
          {view === "terminal" && <TerminalView />}
        </div>
      </main>
    </div>
  );
}

/**
 * Shown instead of the app when the engine cannot be run. A cleanup app that
 * silently does nothing is worse than one that says why, so this states the
 * actual failure rather than a generic apology.
 */
function EngineFailure({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col">
      <div data-tauri-drag-region="deep" className="h-[52px] shrink-0" />
      <div className="flex flex-1 items-center justify-center px-10 pb-16">
        <div className="max-w-[440px]">
          <p className="type-label">清理引擎</p>
          <h1 className="type-title mt-2">引擎无法启动</h1>
          <p className="mt-3 text-ink-muted">
            MkCleaner 的清理能力来自随应用打包的 Mole 引擎。这次没能运行它：
          </p>
          <p className="selectable mt-4 rounded-card border border-hairline bg-surface px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">
            {message}
          </p>
          <p className="mt-4 text-ink-muted">
            开发环境下先运行 <code className="selectable text-ink">pnpm vendor:mole</code> 生成引擎，
            再重新启动。
          </p>
        </div>
      </div>
    </div>
  );
}
