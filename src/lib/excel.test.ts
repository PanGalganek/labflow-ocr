import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { LabResultRow } from "../types";
import { DEFAULT_MAPPING_RULES } from "../types";
import { createWorkbookBuffer } from "./excel";

const rows: LabResultRow[] = [
  {
    id: "1",
    sampleId: "PR-001",
    testDate: "2026-06-19",
    parameter: "pH",
    value: 7.21,
    unit: null,
    referenceRange: "6.8–7.4",
    flag: "normal",
    notes: null,
    confidence: 0.98,
    sourceText: "pH 7,21",
  },
  {
    id: "2",
    sampleId: "PR-001",
    testDate: "2026-06-19",
    parameter: "Przewodność",
    value: 423,
    unit: "µS/cm",
    referenceRange: null,
    flag: "unknown",
    notes: null,
    confidence: 0.91,
    sourceText: "COND 423 µS/cm",
  },
];

describe("Excel export", () => {
  it("creates raw, metadata and mapped worksheets", async () => {
    const buffer = await createWorkbookBuffer({
      rows,
      mappings: DEFAULT_MAPPING_RULES,
      extraction: {
        documentType: "wydruk urządzenia",
        sourceDevice: "miernik",
        language: "pl",
        warnings: [],
      },
      sourceFileName: "wyniki.jpg",
      verified: true,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.getWorksheet("Dane surowe")?.getCell("C2").value).toBe("pH");
    expect(workbook.getWorksheet("Do analizy")?.getCell("C2").value).toBe(7.21);
    expect(workbook.getWorksheet("Do analizy")?.getCell("D3").value).toBe("µS/cm");
    expect(workbook.getWorksheet("Metadane")?.getCell("B7").value).toBe(2);
  });
});
