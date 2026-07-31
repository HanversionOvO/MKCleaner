import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The bar's lower edge dissolving into the content.
 *
 * `backdrop-filter` cannot blur in a gradient — one element blurs uniformly
 * — which is why a single fade strip still reads as a line where its blur
 * suddenly ends. The workaround is a ladder of thin strips, each blurring a
 * little less than the one above and tinting a little less. With steps of a
 * few pixels the eye can't find the joints; the content passing through
 * simply melts out of focus, like the glass edges of iOS 26.
 */
const FADE_STEPS: { blur: number; tint: number }[] = [
  { blur: 16, tint: 1.0 },
  { blur: 13, tint: 0.82 },
  { blur: 10, tint: 0.64 },
  { blur: 7.5, tint: 0.47 },
  { blur: 5, tint: 0.32 },
  { blur: 3, tint: 0.19 },
  { blur: 1.5, tint: 0.09 },
];

const FADE_STEP_H = 5;
const FADE_HEIGHT = FADE_STEPS.length * FADE_STEP_H;

type Props = {
  title: string;
  /** One line under the title. Says what this view is for, not what it is. */
  lede?: string;
  actions?: ReactNode;
  /** Sits in the top bar under the title block — e.g. the analyze breadcrumbs. */
  toolbar?: ReactNode;
  /** The page fills the viewport instead of scrolling (the terminal does). */
  fill?: boolean;
  children: ReactNode;
};

/**
 * Shared frame for every view.
 *
 * The scroll body stretches the whole area — including *under* the top bar —
 * and the bar floats above it. Content starts just below the bar (the body's
 * padding is measured from the bar's real height) and scrolls up beneath it.
 * While the page is at the top the bar is bare; the moment content scrolls,
 * the bar frosts over and what passes underneath is blurred. One surface,
 * one rule.
 */
export function Page({ title, lede, actions, toolbar, fill = false, children }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  // The body's top padding must equal the bar's actual height — no more, no
  // less — so content begins exactly below the bar and slides beneath it.
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const measure = () => setBarHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      {/* Under the bar, so scrolled content passes through it. Flex column so
          a page can opt into filling the viewport (the terminal does); the
          default wrapper must not shrink, or tall pages would compress
          instead of scrolling. */}
      <div
        className="absolute inset-0 flex flex-col overflow-y-auto px-9 pb-9"
        style={{ paddingTop: barHeight }}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
      >
        <div className={fill ? "flex min-h-0 flex-1 flex-col" : "shrink-0"}>{children}</div>
      </div>

      {/* The window has no title bar, so the whole bar doubles as its drag
          handle. `deep` makes the title text draggable too; Tauri exempts
          buttons and other controls in the subtree on its own. */}
      <div
        ref={bar}
        data-tauri-drag-region="deep"
        className={[
          "relative z-10 shrink-0 transition-[background-color,backdrop-filter] duration-[var(--slow)]",
          scrolled ? "bg-glass backdrop-blur-[16px]" : "bg-transparent",
        ].join(" ")}
      >
        <div className="h-[52px]" />
        <header className="flex items-end justify-between gap-6 px-9 pb-5">
          <div className="min-w-0">
            <h1 className="type-title">{title}</h1>
            {lede && <p className="mt-1 text-ink-muted">{lede}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        {toolbar && <div className="px-9 pb-3">{toolbar}</div>}

        {/* See FADE_STEPS above: a ladder of strips, blur and tint stepping
            down together, so the glass melts into the content. */}
        {scrolled && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0"
            style={{ bottom: -FADE_HEIGHT, height: FADE_HEIGHT }}
          >
            {FADE_STEPS.map((step, i) => (
              <div
                key={i}
                className="absolute inset-x-0"
                style={{
                  top: i * FADE_STEP_H,
                  height: FADE_STEP_H,
                  backdropFilter: `blur(${step.blur}px)`,
                  WebkitBackdropFilter: `blur(${step.blur}px)`,
                  background: `linear-gradient(to bottom,
                    color-mix(in srgb, var(--glass) ${Math.round(step.tint * 100)}%, transparent),
                    color-mix(in srgb, var(--glass) ${Math.round(Math.max(0, step.tint - 0.16) * 100)}%, transparent))`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
