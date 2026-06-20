import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { LabResultRow } from "../types";
import { DEFAULT_MAPPING_RULES } from "../types";
import { createWorkbookBuffer } from "./excel";

const rows: LabResultRow[] = [
  {
    id: "1",
    sequenceNumber: "1",
    date: "2026-06-19",
    blankSample: "0,000",
    controlSampleC1: "0,103",
    controlSampleC2: "0,342",
    repeatedSample1: "0,347",
    repeatedSample2: "0,352",
    range: "0,005",
    notes: null,
    confidence: 0.98,
    sourceText: null,
  },
  {
    id: "2",
    sequenceNumber: "2",
    date: "2026-06-20",
    blankSample: "0,001",
    controlSampleC1: "0,102",
    controlSampleC2: "0,341",
    repeatedSample1: "0,344",
    repeatedSample2: "0,349",
    range: "0,005",
    notes: null,
    confidence: 0.91,
    sourceText: null,
  },
];

describe("Excel export", () => {
  it("creates raw and mapped worksheets without metadata", async () => {
    const buffer = await createWorkbookBuffer({
      rows,
      mappings: DEFAULT_MAPPING_RULES,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.getWorksheet("Dane surowe")?.getCell("B2").value).toBeInstanceOf(Date);
    expect(workbook.getWorksheet("Dane surowe")?.getCell("C2").value).toBe(0);
    expect(workbook.getWorksheet("Do analizy")?.getCell("A2").value).toBe("1");
    expect(workbook.getWorksheet("Do analizy")?.getCell("F3").value).toBe(0.344);
    expect(workbook.getWorksheet("Do analizy")?.getCell("H3").value).toBe(0.005);
    expect(workbook.getWorksheet("Metadane")).toBeUndefined();
  });
});
