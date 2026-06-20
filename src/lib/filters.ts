import type { LabField, LabResultRow } from "../types";

export type ValueFilterField = Exclude<LabField, "sequenceNumber" | "date">;

export type ResultFilters = {
  dateFrom: string;
  dateTo: string;
  valueField: ValueFilterField;
  valueMin: string;
  valueMax: string;
  hideEmpty: boolean;
};

export const VALUE_FILTER_FIELDS: ValueFilterField[] = [
  "blankSample",
  "controlSampleC1",
  "controlSampleC2",
  "repeatedSample1",
  "repeatedSample2",
  "range",
];

export const DEFAULT_FILTERS: ResultFilters = {
  dateFrom: "",
  dateTo: "",
  valueField: "blankSample",
  valueMin: "",
  valueMax: "",
  hideEmpty: false,
};

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }
  const polishMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!polishMatch) return null;
  const year = polishMatch[3].length === 2 ? `20${polishMatch[3]}` : polishMatch[3];
  return `${year}-${polishMatch[2].padStart(2, "0")}-${polishMatch[1].padStart(2, "0")}`;
}

function parseNumericValue(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterRows(rows: LabResultRow[], filters: ResultFilters): LabResultRow[] {
  const minimum = parseNumericValue(filters.valueMin);
  const maximum = parseNumericValue(filters.valueMax);
  const hasDateFilter = Boolean(filters.dateFrom || filters.dateTo);
  const hasValueFilter = minimum !== null || maximum !== null || filters.hideEmpty;

  return rows.filter((row) => {
    if (hasDateFilter) {
      const rowDate = normalizeDate(row.date);
      if (!rowDate) return false;
      if (filters.dateFrom && rowDate < filters.dateFrom) return false;
      if (filters.dateTo && rowDate > filters.dateTo) return false;
    }

    if (hasValueFilter) {
      const rawValue = row[filters.valueField];
      const numericValue = parseNumericValue(rawValue);
      if (filters.hideEmpty && !rawValue?.trim()) return false;
      if (minimum !== null && (numericValue === null || numericValue < minimum)) return false;
      if (maximum !== null && (numericValue === null || numericValue > maximum)) return false;
    }

    return true;
  });
}
