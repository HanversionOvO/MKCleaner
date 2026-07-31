import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  children: ReactNode;
};

const VARIANTS = {
  primary:
    "bg-clay text-white hover:bg-clay-hover active:bg-clay-hover disabled:bg-clay disabled:opacity-40",
  secondary:
    "bg-surface text-ink shadow-[0_0_0_1px_var(--hairline-strong)] hover:bg-sunken disabled:opacity-40",
  quiet: "text-ink-muted hover:text-ink hover:bg-sunken disabled:opacity-40",
} as const;

export function Button({ variant = "primary", className = "", ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={[
        "rounded-control px-3.5 py-[7px] font-medium transition-[background-color,color,transform]",
        "duration-[var(--fast)] ease-[var(--ease)] active:scale-[0.98] disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      ].join(" ")}
    />
  );
}
