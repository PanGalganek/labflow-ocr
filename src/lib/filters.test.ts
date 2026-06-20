import { describe, expect, it } from "vitest";
import type { LabResultRow } from "../types";
import { DEFAULT_FILTERS, filterRows } from "./filters";

const rows: LabResultRow[] = [
  { id: "1", sequenceNumber: "1", date: "18.06.2026", blankSample: "0,100", controlSampleC1: null, controlSampleC2: null, repeatedSample1: null, repeatedSample2: null, range: "0,005", confidence: 1, notes: null, sourceText: null },
  { id: "2", sequenceNumber: "2", date: "2026-06-20", blankSample: "0,300", controlSampleC1: null, controlSampleC2: null, repeatedSample1: null, repeatedSample2: null, range: "0,010", confidence: 1, notes: null, sourceText: null },
  { id: "3", sequenceNumber: "3", date: "21/06/26", blankSample: null, controlSampleC1: null, controlSampleC2: null, repeatedSample1: null, repeatedSample2: null, range: "0,020", confidence: 1, notes: null, sourceText: null },
];

describe("result filters", () => {
  it("filters Polish and ISO dates inclusively", () => {
    const result = filterRows(rows, { ...DEFAULT_FILTERS, dateFrom: "2026-06-19", dateTo: "2026-06-21" });
    expect(result.map((row) => row.id)).toEqual(["2", "3"]);
  });

  it("filters comma-decimal values and empty cells", () => {
    const result = filterRows(rows, { ...DEFAULT_FILTERS, valueMin: "0,200", valueMax: "0,400", hideEmpty: true });
    expect(result.map((row) => row.id)).toEqual(["2"]);
  });
});
