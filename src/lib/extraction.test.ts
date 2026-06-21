import { describe, expect, it } from "vitest";
import type { ExtractionResponse } from "../types";
import { mergeExtractions } from "./extraction";

const response = (number: string, warning: string): ExtractionResponse => ({
  documentType: "Karta wyników",
  sourceDevice: null,
  language: "pl",
  warnings: warning ? [warning] : [],
  rows: [{
    sequenceNumber: number,
    date: "2026-06-21",
    blankSample: "0,001",
    controlSampleC1: null,
    controlSampleC2: null,
    repeatedSample1: null,
    repeatedSample2: null,
    range: null,
    confidence: 0.9,
    notes: null,
    sourceText: null,
  }],
});

describe("multiple image extraction", () => {
  it("joins rows and prefixes warnings with source filenames", () => {
    const merged = mergeExtractions([
      { fileName: "strona-1.jpg", response: response("1", "Sprawdź datę") },
      { fileName: "strona-2.jpg", response: response("2", "") },
    ]);

    expect(merged.documentType).toBe("Zestaw 2 dokumentów");
    expect(merged.rows.map((row) => row.sequenceNumber)).toEqual(["1", "2"]);
    expect(merged.warnings).toEqual(["strona-1.jpg: Sprawdź datę"]);
  });
});
