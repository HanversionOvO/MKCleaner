import { useEffect, useState } from "react";
import { fdaStatus, openFdaSettings } from "@/lib/ipc";

/**
 * Tells the user about Full Disk Access.
 *
 * Without FDA macOS pops a TCC permission dialog for every protected
 * directory the cleanup touches — Mail, Safari, each app's caches — which
 * reads as "keeps asking for permissions". The app cannot request FDA itself
 * (macOS forbids it), so this banner detects the gap and jumps the user to
 * the one setting that ends all the dialogs.
 */
export function FdaBanner() {
  const [granted, setGranted] = useState<boolean | null>(null);

  const check = () => {
    void fdaStatus().then(setGranted).catch(() => setGranted(null));
  };

  useEffect(() => {
    check();
  }, []);

  // While unknown or granted, show nothing.
  if (granted !== false) return null;

  return (
    <div className="mb-5 flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface px-5 py-3.5">
      <div className="min-w-0">
        <p className="font-medium text-ink">需要「完全磁盘访问权限」</p>
        <p className="mt-0.5 text-ink-muted">
          未授权时系统会对每个受保护目录反复弹出权限请求，且部分系统缓存无法清理。
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void openFdaSettings()}
          className="rounded-control bg-clay px-3.5 py-[7px] font-medium text-white transition-colors duration-[var(--fast)] hover:bg-clay-hover"
        >
          打开设置
        </button>
        <button
          type="button"
          onClick={check}
          className="rounded-control bg-surface px-3.5 py-[7px] font-medium text-ink shadow-[0_0_0_1px_var(--hairline-strong)] transition-colors duration-[var(--fast)] hover:bg-sunken"
        >
          我已授权
        </button>
      </div>
    </div>
  );
}
