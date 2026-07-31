import type { ReactNode } from "react";

/**
 * Plays the fade-and-rise on mount.
 *
 * Pair with a changing `key` on the parent to transition between states: the
 * key remounts the subtree, which replays the animation.
 */
export function FadeIn({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`fade-in ${className}`.trim()}>{children}</div>;
}
