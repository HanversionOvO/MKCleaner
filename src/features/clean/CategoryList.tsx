import { useState } from "react";
import { Checkbox } from "@/components/Checkbox";
import { formatBytes, formatCount, shortenPath } from "@/lib/format";
import type { CleanCategory } from "@/lib/ipc";
import { categoryName } from "./categories";

type Props = {
  categories: CleanCategory[];
  /** Paths the user has unchecked. */
  excluded: Set<string>;
  onToggle: (paths: string[], excluded: boolean) => void;
  home: string;
  disabled?: boolean;
};

export function CategoryList({ categories, excluded, onToggle, home, disabled }: Props) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      {categories.map((category, i) => (
        <Row
          key={category.name}
          category={category}
          excluded={excluded}
          onToggle={onToggle}
          home={home}
          disabled={disabled}
          first={i === 0}
        />
      ))}
    </div>
  );
}

function Row({
  category,
  excluded,
  onToggle,
  home,
  disabled,
  first,
}: {
  category: CleanCategory;
  excluded: Set<string>;
  onToggle: (paths: string[], excluded: boolean) => void;
  home: string;
  disabled?: boolean;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);

  const paths = category.items.map((i) => i.path);
  const keptCount = paths.filter((p) => !excluded.has(p)).length;
  const allKept = keptCount === paths.length;
  const noneKept = keptCount === 0;
  const selectedBytes = category.items
    .filter((i) => !excluded.has(i.path))
    .reduce((sum, i) => sum + i.bytes, 0);

  return (
    <section className={first ? "" : "border-t border-hairline"}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Checkbox
          checked={allKept}
          indeterminate={!allKept && !noneKept}
          onChange={(next) => !disabled && onToggle(paths, !next)}
          label={`清理${categoryName(category.name)}`}
        />

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron open={open} />
          <span className={`font-medium ${noneKept ? "text-ink-faint" : "text-ink"}`}>
            {categoryName(category.name)}
          </span>
          <span className="type-data text-ink-faint">{formatCount(keptCount)} 项</span>
        </button>

        <span
          className={`type-data shrink-0 tabular-nums ${
            noneKept ? "text-ink-faint" : "text-ink"
          }`}
        >
          {formatBytes(selectedBytes)}
        </span>
      </div>

      {open && (
        <ul className="fade-in border-t border-hairline bg-[color-mix(in_srgb,var(--sunken)_55%,transparent)] py-1">
          {category.items.map((item) => {
            const off = excluded.has(item.path);
            const shown = shortenPath(item.path, home);
            const cut = shown.lastIndexOf("/");
            return (
              <li key={item.path} className="flex items-center gap-3 py-[5px] pl-4 pr-4">
                <Checkbox
                  checked={!off}
                  onChange={(next) => !disabled && onToggle([item.path], !next)}
                  label={`清理 ${shown}`}
                />
                <span
                  className={`selectable min-w-0 flex-1 truncate text-[12.5px] ${
                    off ? "text-ink-faint line-through decoration-1" : ""
                  }`}
                  title={item.path}
                  dir="rtl"
                >
                  <span dir="ltr">
                    <span className="text-ink-faint">{shown.slice(0, cut + 1)}</span>
                    <span className={off ? "text-ink-faint" : "text-ink-muted"}>
                      {shown.slice(cut + 1)}
                    </span>
                  </span>
                </span>
                <span
                  className={`type-data shrink-0 text-[12.5px] ${
                    off ? "text-ink-faint" : "text-ink-muted"
                  }`}
                >
                  {formatBytes(item.bytes)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden="true"
      className="shrink-0 text-ink-faint transition-transform duration-[var(--fast)] ease-[var(--ease)]"
      style={{ transform: open ? "rotate(90deg)" : "none" }}
    >
      <path
        d="M3 1.6 6.2 4.5 3 7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
