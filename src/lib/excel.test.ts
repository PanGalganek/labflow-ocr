import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { LabResultRow, MappingRule } from "../types";
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
  it("creates raw and typed tables with working filter buttons", async () => {
    const mappings: MappingRule[] = [{
      id: "extra-range",
      sourceField: "range",
      targetSheet: "Raport",
      startCell: "A1",
      direction: "down",
      includeHeader: true,
    }];
    const buffer = await createWorkbookBuffer({
      rows,
      mappings,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.slice(0, 2).map((sheet) => sheet.name)).toEqual([
      "Dane surowe",
      "Dane dopasowane",
    ]);

    const rawSheet = workbook.getWorksheet("Dane surowe");
    const formattedSheet = workbook.getWorksheet("Dane dopasowane");
    expect(rawSheet?.getCell("B2").value).toBe("2026-06-19");
    expect(rawSheet?.getCell("C2").value).toBe("0,000");
    const formattedDate = formattedSheet?.getCell("B2").value;
    expect(formattedSheet?.getCell("A2").value).toBe(1);
    expect(formattedDate).toBeInstanceOf(Date);
    expect((formattedDate as Date).toISOString()).toBe("2026-06-19T00:00:00.000Z");
    expect(formattedSheet?.getCell("C2").value).toBe(0);

    const rawTable = rawSheet?.getTable("LabFlowRawData");
    const formattedTable = formattedSheet?.getTable("LabFlowFormattedData");
    const rawTableModel = (rawTable as unknown as { model: { autoFilterRef: string; columns: Array<{ filterButton?: boolean }> } }).model;
    const formattedTableModel = (formattedTable as unknown as { model: { autoFilterRef: string; columns: Array<{ filterButton?: boolean }> } }).model;
    expect(rawTableModel.autoFilterRef).toBe("A1:H3");
    expect(formattedTableModel.autoFilterRef).toBe("A1:H3");
    expect(rawTableModel.columns.every((column) => column.filterButton)).toBe(true);
    expect(formattedTableModel.columns.every((column) => column.filterButton)).toBe(true);
    expect(workbook.getWorksheet("Raport")?.getCell("A3").value).toBe(0.005);
    expect(workbook.getWorksheet("Metadane")).toBeUndefined();
  });
});
