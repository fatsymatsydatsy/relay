"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  findMedication,
  matchMedications,
  type Medication,
} from "@/lib/search/medications";

interface MedicationComboboxProps {
  value: string;
  /** id of the visible label element — wired to aria-labelledby (codex P2-8). */
  labelledBy?: string;
  invalid?: boolean;
  describedBy?: string;
  onChange(value: string): void;
  /** Fires with the medication when a known one is chosen, or null otherwise. */
  onSelect(medication: Medication | null): void;
}

export default function MedicationCombobox({
  value,
  labelledBy,
  invalid,
  describedBy,
  onChange,
  onSelect,
}: MedicationComboboxProps) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const suggestions = matchMedications(value);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function commit(medication: Medication) {
    onChange(medication.name);
    onSelect(medication);
    setOpen(false);
    setActive(-1);
  }

  function handleChange(next: string) {
    onChange(next);
    onSelect(findMedication(next));
    setOpen(true);
    setActive(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && suggestions[active]) {
        e.preventDefault();
        commit(suggestions[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          active >= 0 ? `${listId}-opt-${active}` : undefined
        }
        aria-labelledby={labelledBy}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder="e.g. Propranolol"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="field w-full px-4 py-3 text-[15px]"
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Medication suggestions"
          className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-card border border-line bg-surface py-1 shadow-[0_10px_30px_-14px_rgba(19,42,36,0.35)]"
        >
          {suggestions.map((med, i) => (
            <li
              key={med.name}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              // Mouse-selection: mousedown fires before the input blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(med);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 ${
                i === active ? "bg-mist" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">
                  {med.name}
                </span>
                <span className="block truncate text-xs text-muted">
                  {med.use}
                </span>
              </span>
              {med.shortage && (
                <span className="shrink-0 rounded-pill bg-coral-soft px-2 py-0.5 text-[11px] font-medium text-coral-deep">
                  Shortage
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
