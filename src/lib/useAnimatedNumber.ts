import { useEffect, useRef, useState } from "react";

const reduced =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Eases a displayed number towards a target.
 *
 * Feeding the same target twice is a no-op; changing it continues from the
 * current displayed value, so the cleanup figure keeps counting up smoothly
 * while its target advances every tick.
 */
export function useAnimatedNumber(
  target: number,
  duration = 420,
  initial = 0,
): number {
  const [value, setValue] = useState(initial);
  const shown = useRef(initial);

  useEffect(() => {
    if (reduced || shown.current === target) {
      shown.current = target;
      setValue(target);
      return;
    }

    const from = shown.current;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      shown.current = next;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
