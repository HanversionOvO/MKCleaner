type Props = {
  checked: boolean;
  /** Some but not all children are checked. */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
};

/** Checkbox in the app's own idiom — a native one would import macOS blue. */
export function Checkbox({ checked, indeterminate = false, onChange, label }: Props) {
  const filled = checked || indeterminate;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        "grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4.5px] transition-all",
        "duration-[var(--fast)] ease-[var(--ease)]",
        filled
          ? "bg-clay shadow-[0_0_0_1px_var(--clay)]"
          : "bg-surface shadow-[0_0_0_1px_var(--hairline-strong)] hover:shadow-[0_0_0_1px_var(--ink-faint)]",
      ].join(" ")}
    >
      {indeterminate ? (
        <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
          <path d="M1.8 4.5h5.4" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : (
        checked && (
          <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
            <path
              d="M1.4 4.7 3.5 6.8 7.6 2.4"
              fill="none"
              stroke="white"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )
      )}
    </button>
  );
}
