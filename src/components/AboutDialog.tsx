import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { licensePath, type EngineInfo } from "@/lib/ipc";
import { checkForUpdates, installUpdate, useUpdate } from "@/lib/updateStore";

const AUTHOR_URL = "https://github.com/HanversionOvO";
const REPO_URL = "https://github.com/HanversionOvO/MKCleaner";

/** The update button's label for each state. */
const UPDATE_LABELS: Record<string, string> = {
  idle: "检查更新",
  checking: "检查中…",
  none: "已是最新版本",
  available: "",
  installing: "更新中…",
  installed: "更新完成，请重启",
  error: "更新失败，重试",
};

export function AboutDialog({
  engine,
  onClose,
}: {
  engine: EngineInfo | null;
  onClose: () => void;
}) {
  const [version, setVersion] = useState("0.1.0");
  const update = useUpdate();
  // Exit animation: the dialog closes itself a beat after being asked to.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onClose, 200);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Portal to <body>: the sidebar's backdrop-filter creates a containing
  // block for fixed descendants, which would trap the dialog inside the nav.
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_30%,transparent)] ${
        leaving ? "exit-fade" : "fade-in"
      }`}
      onPointerDown={close}
      role="dialog"
      aria-modal="true"
      aria-label="关于 MkCleaner"
    >
      <div
        className={`rise-in w-[400px] rounded-card border border-hairline bg-surface p-7 shadow-[0_18px_50px_-16px_color-mix(in_srgb,var(--ink)_35%)] ${
          leaving ? "rise-out" : ""
        }`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <Logo />
          <div className="min-w-0 flex-1">
            <p className="type-figure text-[1.7rem] text-ink">MkCleaner</p>
            <p className="mt-0.5 text-ink-muted">版本 {version}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="rounded-control p-1.5 text-ink-faint transition-colors duration-[var(--fast)] hover:bg-sunken hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <dl className="mt-5 space-y-2.5 border-t border-hairline pt-5 text-[13px]">
          <Row label="作者">
            <a
              href={AUTHOR_URL}
              onClick={(e) => {
                e.preventDefault();
                void openUrl(AUTHOR_URL);
              }}
              className="text-ink transition-colors duration-[var(--fast)] hover:text-clay"
            >
              @MikannQAQ
            </a>
          </Row>
          <Row label="项目仓库">
            <a
              href={REPO_URL}
              onClick={(e) => {
                e.preventDefault();
                void openUrl(REPO_URL);
              }}
              className="text-ink transition-colors duration-[var(--fast)] hover:text-clay"
            >
              HanversionOvO/MKCleaner
            </a>
          </Row>
          <Row label="清理引擎">Mole {engine?.version ?? ""}</Row>
        </dl>

        {update.status === "error" && (
          <p className="selectable mt-4 rounded-control bg-sunken px-3 py-2 font-mono text-[11.5px] text-rust">
            {update.message}
          </p>
        )}

        {/* The two quiet actions sit together on the right, macOS dialog
            style. Update state lives inside its button, nothing floats loose. */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              void licensePath().then((path) => {
                if (path) void openPath(path);
              });
            }}
            className="rounded-control bg-surface px-3.5 py-[7px] font-medium text-ink shadow-[0_0_0_1px_var(--hairline-strong)] transition-colors duration-[var(--fast)] hover:bg-sunken"
          >
            开源许可
          </button>

          {UPDATE_LABELS[update.status] !== undefined && (
            <button
              type="button"
              onClick={() => {
                if (update.status === "available") void installUpdate();
                else if (update.status === "error") void checkForUpdates();
              }}
              disabled={
                update.status === "checking" ||
                update.status === "none" ||
                update.status === "installing" ||
                update.status === "installed"
              }
              className={`rounded-control px-3.5 py-[7px] font-medium transition-colors duration-[var(--fast)] disabled:opacity-50 ${
                update.status === "available"
                  ? "bg-clay text-white hover:bg-clay-hover"
                  : "bg-surface text-ink shadow-[0_0_0_1px_var(--hairline-strong)] hover:bg-sunken"
              }`}
            >
              {update.status === "available"
                ? `更新到 v${update.version}`
                : UPDATE_LABELS[update.status]}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-16 shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** The app's logo — the vector mark, drawn in the current text colour so it
 *  works in both themes. Same art as the app icon. */
function Logo() {
  return (
    <svg
      width="46"
      height="46"
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      className="shrink-0 text-ink"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M676 132C685 132 693 136 701 141L719 152C735 161 742 171 737 185L690 312C689 317 692 318 697 315L704 308C709 304 714 303 720 303L805 303C818 303 825 312 819 326L746 524C741 538 741 548 748 561L835 735C846 757 833 774 812 772L557 744C543 743 534 736 528 724L484 611L227 765C216 771 205 771 196 767L152 744C141 738 137 725 143 713L378 278C383 268 390 263 400 258L648 136C659 131 668 130 676 132ZM430 276L660 155C665 152 670 153 675 157L702 172L503 309C497 313 490 313 483 309ZM405 293L466 328L506 478L688 329C694 325 700 323 707 323L784 323L455 599L416 449C415 444 410 442 406 447L204 737L183 729L394 307C399 297 402 292 405 293ZM602 500L807 744L679 730C672 729 667 725 663 720L537 554Z"
      />
      <path d="M827 138C830 169 841 184 879 193C842 198 833 210 828 246C823 211 812 200 775 193C811 187 822 174 827 138Z" />
      <circle cx="777" cy="249" r="22.5" />
      <circle cx="780" cy="244" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
