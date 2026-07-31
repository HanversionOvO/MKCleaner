import { useEffect, useState } from "react";
import { fdaStatus, openFdaSettings, setOnboardingWindow } from "@/lib/ipc";

export function FdaOnboarding({ onDone }: { onDone: () => void }) {
  const [checking, setChecking] = useState(false);
  const [denied, setDenied] = useState(false);

  // The onboarding is a fixed-size window, not a resizable one.
  useEffect(() => {
    void setOnboardingWindow(true);
    return () => {
      void setOnboardingWindow(false);
    };
  }, []);

  const recheck = async () => {
    setChecking(true);
    setDenied(false);
    try {
      if (await fdaStatus()) onDone();
      else setDenied(true);
    } catch {
      setDenied(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Drag strip for the window. */}
      <div data-tauri-drag-region="deep" className="h-[52px] shrink-0" />

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-10 pb-14">
        <div className="w-[440px]">
          <Logo />
          <p className="type-title mt-5 text-[1.9rem]">清理需要一次授权</p>
          <p className="mt-3 leading-relaxed text-ink-muted">
            清理工具要读取各个应用的缓存与日志，macOS 要求获得
            <span className="text-ink">「完全磁盘访问权限」</span>。
            没有它，系统会对每个目录反复弹出权限请求，且部分缓存无法清理。
          </p>

          <ol className="mt-7 space-y-4">
            <Step
              n={1}
              title="打开系统设置"
              body="点击下方按钮，进入「完全磁盘访问权限」面板。"
            />
            <Step n={2} title="添加 MkCleaner" body="点击 + 号，在应用程序里选择 MkCleaner。" />
            <Step n={3} title="回来继续" body="回到这里，点「我已授权」即可开始使用。" />
          </ol>

          <div className="mt-9 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void openFdaSettings()}
              className="rounded-control bg-clay px-4 py-2 font-medium text-white transition-colors duration-[var(--fast)] hover:bg-clay-hover"
            >
              打开设置
            </button>
            <button
              type="button"
              onClick={() => void recheck()}
              disabled={checking}
              className="rounded-control bg-surface px-4 py-2 font-medium text-ink shadow-[0_0_0_1px_var(--hairline-strong)] transition-colors duration-[var(--fast)] hover:bg-sunken disabled:opacity-50"
            >
              {checking ? "检测中…" : "我已授权"}
            </button>
          </div>

          {denied && (
            <p className="mt-4 rounded-control bg-clay-soft px-4 py-3 text-[13px] text-ink">
              还没有检测到授权。请确认已在「完全磁盘访问权限」中添加 MkCleaner，然后重试。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-clay-soft font-medium text-clay">
        {n}
      </span>
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{body}</p>
      </div>
    </li>
  );
}

function Logo() {
  return (
    <svg width="64" height="64" viewBox="0 0 1024 1024" aria-hidden="true" fill="currentColor" className="text-ink">
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
