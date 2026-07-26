export interface Medication {
  name: string;
  /** Available dose/strength options, most common first. Auto-filled on select. */
  doses: string[];
  /** Short "used for" note shown in the suggestion list. */
  use: string;
  /** Currently in active UK shortage — surfaced in the suggestion list. */
  shortage?: boolean;
}

/**
 * A small catalogue of common UK medications used to power the search
 * autocomplete and dose auto-fill. Not exhaustive — the field still accepts a
 * free-typed medication the catalogue doesn't know.
 */
export const MEDICATIONS: Medication[] = [
  { name: "Propranolol", doses: ["80mg MR", "160mg MR", "40mg", "10mg"], use: "Anxiety, migraine, heart", shortage: true },
  { name: "Ramipril", doses: ["2.5mg", "5mg", "10mg", "1.25mg"], use: "Blood pressure", shortage: true },
  { name: "Estradot", doses: ["50 patches", "75 patches", "100 patches", "37.5 patches", "25 patches"], use: "HRT", shortage: true },
  { name: "Creon", doses: ["10,000", "25,000", "40,000"], use: "Pancreatic enzyme", shortage: true },
  { name: "Oestrogel", doses: ["0.75mg/pump"], use: "HRT", shortage: true },
  { name: "Methylphenidate", doses: ["18mg MR", "27mg MR", "36mg MR", "54mg MR"], use: "ADHD", shortage: true },
  { name: "Levothyroxine", doses: ["25mcg", "50mcg", "75mcg", "100mcg", "125mcg"], use: "Thyroid" },
  { name: "Atorvastatin", doses: ["20mg", "40mg", "10mg", "80mg"], use: "Cholesterol" },
  { name: "Sertraline", doses: ["50mg", "100mg", "25mg"], use: "Antidepressant" },
  { name: "Omeprazole", doses: ["20mg", "10mg", "40mg"], use: "Acid reflux" },
  { name: "Amoxicillin", doses: ["500mg", "250mg"], use: "Antibiotic" },
  { name: "Metformin", doses: ["500mg", "850mg", "1000mg MR"], use: "Diabetes" },
  { name: "Salbutamol", doses: ["100mcg inhaler"], use: "Asthma reliever" },
  { name: "Amlodipine", doses: ["5mg", "10mg"], use: "Blood pressure" },
  // Current active UK shortages
  { name: "Semaglutide (Ozempic)", doses: ["0.25mg", "0.5mg", "1mg", "2mg"], use: "Type 2 diabetes, weight", shortage: true },
  { name: "Lisdexamfetamine (Elvanse)", doses: ["20mg", "30mg", "40mg", "50mg", "60mg", "70mg"], use: "ADHD", shortage: true },
  { name: "Atomoxetine", doses: ["10mg", "18mg", "25mg", "40mg", "60mg", "80mg"], use: "ADHD", shortage: true },
  { name: "Guanfacine", doses: ["1mg", "2mg", "3mg", "4mg"], use: "ADHD", shortage: true },
  // Pain relief
  { name: "Co-codamol", doses: ["8/500", "15/500", "30/500"], use: "Pain relief" },
  { name: "Codeine", doses: ["15mg", "30mg", "60mg"], use: "Pain relief" },
  { name: "Naproxen", doses: ["250mg", "500mg"], use: "Anti-inflammatory" },
  { name: "Amitriptyline", doses: ["10mg", "25mg", "50mg"], use: "Nerve pain, low mood" },
  { name: "Gabapentin", doses: ["100mg", "300mg", "400mg", "600mg", "800mg"], use: "Nerve pain, epilepsy" },
  { name: "Pregabalin", doses: ["25mg", "50mg", "75mg", "100mg", "150mg", "300mg"], use: "Nerve pain, anxiety" },
  // Heart & blood pressure
  { name: "Bisoprolol", doses: ["1.25mg", "2.5mg", "3.75mg", "5mg", "10mg"], use: "Heart, blood pressure" },
  { name: "Lisinopril", doses: ["2.5mg", "5mg", "10mg", "20mg"], use: "Blood pressure" },
  { name: "Losartan", doses: ["25mg", "50mg", "100mg"], use: "Blood pressure" },
  { name: "Candesartan", doses: ["4mg", "8mg", "16mg", "32mg"], use: "Blood pressure" },
  { name: "Furosemide", doses: ["20mg", "40mg"], use: "Water retention" },
  { name: "Simvastatin", doses: ["10mg", "20mg", "40mg", "80mg"], use: "Cholesterol" },
  { name: "Clopidogrel", doses: ["75mg"], use: "Blood thinner" },
  { name: "Apixaban", doses: ["2.5mg", "5mg"], use: "Blood thinner" },
  { name: "Rivaroxaban", doses: ["2.5mg", "10mg", "15mg", "20mg"], use: "Blood thinner" },
  { name: "Warfarin", doses: ["0.5mg", "1mg", "3mg", "5mg"], use: "Blood thinner" },
  // Mental health
  { name: "Citalopram", doses: ["10mg", "20mg", "40mg"], use: "Antidepressant" },
  { name: "Fluoxetine", doses: ["10mg", "20mg", "60mg"], use: "Antidepressant" },
  { name: "Mirtazapine", doses: ["15mg", "30mg", "45mg"], use: "Antidepressant" },
  { name: "Venlafaxine", doses: ["37.5mg", "75mg", "150mg"], use: "Antidepressant" },
  { name: "Duloxetine", doses: ["30mg", "60mg"], use: "Nerve pain, low mood" },
  // Stomach & gut
  { name: "Lansoprazole", doses: ["15mg", "30mg"], use: "Acid reflux" },
  { name: "Esomeprazole", doses: ["20mg", "40mg"], use: "Acid reflux" },
  // Diabetes
  { name: "Gliclazide", doses: ["40mg", "80mg"], use: "Diabetes" },
  { name: "Dapagliflozin", doses: ["5mg", "10mg"], use: "Diabetes" },
  // Respiratory
  { name: "Montelukast", doses: ["4mg", "5mg", "10mg"], use: "Asthma" },
  { name: "Beclometasone", doses: ["50mcg", "100mcg", "200mcg"], use: "Asthma inhaler" },
  { name: "Prednisolone", doses: ["1mg", "5mg", "25mg"], use: "Steroid" },
  // Infections
  { name: "Doxycycline", doses: ["50mg", "100mg"], use: "Antibiotic" },
  { name: "Nitrofurantoin", doses: ["50mg", "100mg"], use: "Antibiotic (UTI)" },
  { name: "Trimethoprim", doses: ["100mg", "200mg"], use: "Antibiotic (UTI)" },
  // Other common
  { name: "Tamsulosin", doses: ["400mcg"], use: "Prostate" },
  { name: "Finasteride", doses: ["1mg", "5mg"], use: "Prostate, hair loss" },
  { name: "Ferrous sulfate", doses: ["200mg"], use: "Iron / anaemia" },
  { name: "Folic acid", doses: ["400mcg", "5mg"], use: "Supplement" },
  { name: "Colecalciferol (Vitamin D)", doses: ["800 units", "1000 units", "20,000 units"], use: "Vitamin D" },
  { name: "Evorel patches", doses: ["25 patches", "50 patches", "75 patches", "100 patches"], use: "HRT" },
  { name: "Utrogestan", doses: ["100mg", "200mg"], use: "HRT (progesterone)" },
];

/** Numeric strength of a dose string for sorting ("160mg MR" → 160,
 *  "10,000" → 10000, "0.75mg/pump" → 0.75). */
function doseValue(dose: string): number {
  const match = dose.replace(/,/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : Number.POSITIVE_INFINITY;
}

/** A medication's doses ordered lowest strength to highest. */
export function orderedDoses(medication: Medication): string[] {
  return [...medication.doses].sort((a, b) => doseValue(a) - doseValue(b));
}

/** Exact (case-insensitive) lookup, used to detect when a typed value is a
 *  known medication so its dose can be auto-filled. */
export function findMedication(query: string): Medication | null {
  const normalized = query.trim().toLowerCase();
  return MEDICATIONS.find((m) => m.name.toLowerCase() === normalized) ?? null;
}

/** Prefix-then-substring matches for the suggestion list. */
export function matchMedications(query: string, limit = 6): Medication[] {
  const q = query.trim().toLowerCase();
  if (!q) return MEDICATIONS.filter((m) => m.shortage).slice(0, limit);
  const starts = MEDICATIONS.filter((m) => m.name.toLowerCase().startsWith(q));
  const contains = MEDICATIONS.filter(
    (m) => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q),
  );
  return [...starts, ...contains].slice(0, limit);
}
