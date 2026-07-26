"use client";

import { useId, useRef, useState } from "react";
import type { SearchRequest } from "@/lib/search/types";
import { normalizePostcode } from "@/lib/search/geocode";
import { orderedDoses, type Medication } from "@/lib/search/medications";
import MedicationCombobox from "./MedicationCombobox";

interface SearchFormProps {
  onSearch(request: SearchRequest): void;
}

export default function SearchForm({ onSearch }: SearchFormProps) {
  const baseId = useId();
  const errorId = `${baseId}-error`;
  const [values, setValues] = useState<SearchRequest>({
    medication: "",
    dose: "",
    quantity: 1,
    postcode: "",
  });
  const [selectedMed, setSelectedMed] = useState<Medication | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether the dose came from auto-fill, so editing the medication
  // never silently submits the previous drug's strength (codex P2-9).
  const doseAutoFilled = useRef(false);

  function handleMedicationSelect(medication: Medication | null) {
    setSelectedMed(medication);
    if (medication) {
      // Auto-fill the dose with the medication's lowest available strength.
      setValues((v) => ({ ...v, dose: orderedDoses(medication)[0] }));
      doseAutoFilled.current = true;
    } else if (doseAutoFilled.current) {
      setValues((v) => ({ ...v, dose: "" }));
      doseAutoFilled.current = false;
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.medication.trim() || !values.postcode.trim()) {
      setError("Enter a medication and postcode to start the search.");
      return;
    }
    // Validated + canonicalized before it is used anywhere (codex P1-4/P2-1).
    const postcode = normalizePostcode(values.postcode);
    if (!postcode) {
      setError("That doesn't look like a UK postcode — e.g. SW1A 1AA.");
      return;
    }
    onSearch({
      medication: values.medication.trim(),
      dose: values.dose.trim(),
      quantity: values.quantity,
      postcode,
    });
  }

  const doseId = `${baseId}-dose`;
  const quantityId = `${baseId}-quantity`;
  const postcodeId = `${baseId}-postcode`;
  const medLabelId = `${baseId}-med-label`;

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Find your medication">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-8">
        <div className="sm:col-span-3">
          <label
            id={medLabelId}
            className="mb-1.5 block text-sm font-medium text-ink"
          >
            Medication
          </label>
          <MedicationCombobox
            value={values.medication}
            labelledBy={medLabelId}
            invalid={error !== null && !values.medication.trim()}
            describedBy={error !== null ? errorId : undefined}
            onChange={(medication) => {
              setValues((v) => ({ ...v, medication }));
              if (error !== null) setError(null);
            }}
            onSelect={handleMedicationSelect}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={doseId} className="mb-1.5 block text-sm font-medium text-ink">
            Dose{" "}
            <span className="font-normal text-muted">
              {selectedMed ? "(auto-filled)" : "(optional)"}
            </span>
          </label>
          {selectedMed && selectedMed.doses.length > 1 ? (
            <select
              id={doseId}
              value={values.dose}
              onChange={(e) =>
                setValues((v) => ({ ...v, dose: e.target.value }))
              }
              className="field w-full px-4 py-3 text-[15px]"
            >
              {orderedDoses(selectedMed).map((dose) => (
                <option key={dose} value={dose}>
                  {dose}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={doseId}
              type="text"
              autoComplete="off"
              placeholder="e.g. 80mg MR"
              value={values.dose}
              onChange={(e) =>
                setValues((v) => ({ ...v, dose: e.target.value }))
              }
              className="field w-full px-4 py-3 text-[15px]"
            />
          )}
        </div>

        <div className="sm:col-span-1">
          <label htmlFor={quantityId} className="mb-1.5 block text-sm font-medium text-ink">
            Packs
          </label>
          <select
            id={quantityId}
            value={values.quantity}
            onChange={(e) =>
              setValues((v) => ({ ...v, quantity: Number(e.target.value) }))
            }
            className="field w-full px-3 py-3 text-[15px]"
          >
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={postcodeId} className="mb-1.5 block text-sm font-medium text-ink">
            Postcode
          </label>
          <input
            id={postcodeId}
            type="text"
            autoComplete="postal-code"
            placeholder="e.g. SW1A 1AA"
            value={values.postcode}
            onChange={(e) => {
              setValues((v) => ({ ...v, postcode: e.target.value }));
              if (error !== null) setError(null);
            }}
            aria-invalid={error !== null && !normalizePostcode(values.postcode)}
            aria-describedby={error !== null ? errorId : undefined}
            className="field w-full px-4 py-3 text-[15px]"
          />
        </div>
      </div>

      {error !== null && (
        <p id={errorId} role="alert" className="mt-3 text-sm text-coral-deep">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn-primary mt-5 w-full px-6 py-3.5 text-[15px] sm:w-auto"
      >
        Find my medication
      </button>
    </form>
  );
}
