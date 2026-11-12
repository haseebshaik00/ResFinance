import { CalendarDays } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function MonthPicker({
  month,
  onChange,
  label,
}: {
  month: string;
  onChange: (month: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [displayedYear, setDisplayedYear] = useState(() => monthYear(month));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectMonth(nextMonth: string) {
    onChange(nextMonth);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function toggleMenu() {
    if (!open) setDisplayedYear(monthYear(month));
    setOpen((current) => !current);
  }

  return (
    <div
      className="month-control reporting-month-control reporting-month-picker"
      ref={rootRef}
    >
      <span id={labelId}>{label}</span>
      <button
        ref={triggerRef}
        className="reporting-month-trigger"
        type="button"
        aria-labelledby={`${labelId} ${menuId}-selected`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggleMenu}
      >
        <span id={`${menuId}-selected`}>{formatMonth(month)}</span>
        <CalendarDays
          className="reporting-month-trigger-icon"
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          id={menuId}
          className="reporting-month-menu"
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
        >
          <div className="reporting-month-menu-header">
            <button
              type="button"
              aria-label={`Previous year, ${displayedYear - 1}`}
              onClick={() => setDisplayedYear((year) => year - 1)}
            >
              ←
            </button>
            <strong aria-live="polite">{displayedYear}</strong>
            <button
              type="button"
              aria-label={`Next year, ${displayedYear + 1}`}
              onClick={() => setDisplayedYear((year) => year + 1)}
            >
              →
            </button>
          </div>
          <div className="reporting-month-grid">
            {MONTH_NAMES.map((name, index) => {
              const value = `${displayedYear}-${String(index + 1).padStart(2, "0")}`;
              const selected = value === month;
              return (
                <button
                  key={value}
                  className={selected ? "is-selected" : undefined}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectMonth(value)}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <div className="reporting-month-menu-footer">
            <button type="button" onClick={() => selectMonth(currentMonth())}>
              This month
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function monthYear(month: string): number {
  return Number(month.slice(0, 4));
}

function formatMonth(month: string): string {
  const monthIndex = Number(month.slice(5, 7)) - 1;
  return `${MONTH_NAMES[monthIndex]} ${monthYear(month)}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
