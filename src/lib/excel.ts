import ExcelJS from "exceljs";
import type {
  ExtractionResponse,
  LabField,
  LabResultRow,
  MappingRule,
} from "../types";
import { LAB_FIELD_LABELS } from "../types";

const RAW_SHEET_NAME = "Dane surowe";
const META_SHEET_NAME = "Metadane";
const INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;
const CELL_REFERENCE = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/i;

export type WorkbookExportOptions = {
  rows: LabResultRow[];
  mappings: MappingRule[];
  extraction: Pick<ExtractionResponse, "documentType" | "sourceDevice" | "language" | "warnings">;
  sourceFileName: string;
  templateFile?: File | null;
  verified: boolean;
};

function safeSheetName(value: string): string {
  const sanitized = value.replace(INVALID_SHEET_CHARS, " ").trim().slice(0, 31);
  return sanitized || "Wyniki";
}

function getOrReplaceSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const existing = workbook.getWorksheet(name);
  if (existing) {
    workbook.removeWorksheet(existing.id);
  }
  return workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
}

function normalizeCellValue(value: LabResultRow[LabField]): ExcelJS.CellValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0D3F45" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF0A2E33" } },
    };
  });
}

function populateRawSheet(workbook: ExcelJS.Workbook, rows: LabResultRow[]): void {
  const sheet = getOrReplaceSheet(workbook, RAW_SHEET_NAME);
  sheet.columns = [
    { header: LAB_FIELD_LABELS.sequenceNumber, key: "sequenceNumber", width: 10 },
    { header: LAB_FIELD_LABELS.date, key: "date", width: 16 },
    { header: LAB_FIELD_LABELS.blankSample, key: "blankSample", width: 18 },
    { header: LAB_FIELD_LABELS.controlSampleC1, key: "controlSampleC1", width: 23 },
    { header: LAB_FIELD_LABELS.controlSampleC2, key: "controlSampleC2", width: 23 },
    { header: LAB_FIELD_LABELS.repeatedSample1, key: "repeatedSample1", width: 25 },
    { header: LAB_FIELD_LABELS.repeatedSample2, key: "repeatedSample2", width: 25 },
    { header: LAB_FIELD_LABELS.range, key: "range", width: 16 },
    { header: "Pewność", key: "confidence", width: 14 },
    { header: "Uwagi", key: "notes", width: 34 },
    { header: "Tekst źródłowy", key: "sourceText", width: 42 },
  ];

  rows.forEach((row) => {
    sheet.addRow({
      sequenceNumber: row.sequenceNumber ?? "",
      date: row.date ?? "",
      blankSample: row.blankSample ?? "",
      controlSampleC1: row.controlSampleC1 ?? "",
      controlSampleC2: row.controlSampleC2 ?? "",
      repeatedSample1: row.repeatedSample1 ?? "",
      repeatedSample2: row.repeatedSample2 ?? "",
      range: row.range ?? "",
      confidence: row.confidence,
      notes: row.notes ?? "",
      sourceText: row.sourceText ?? "",
    });
  });

  styleHeaderRow(sheet.getRow(1));
  sheet.getColumn("confidence").numFmt = "0%";
  sheet.autoFilter = { from: "A1", to: "K1" };
  sheet.eachRow((row, index) => {
    if (index > 1) {
      row.alignment = { vertical: "top", wrapText: true };
    }
  });
}

function populateMetadataSheet(
  workbook: ExcelJS.Workbook,
  options: WorkbookExportOptions,
): void {
  const sheet = getOrReplaceSheet(workbook, META_SHEET_NAME);
  const metadata: Array<[string, string | number]> = [
    ["Plik źródłowy", options.sourceFileName],
    ["Data eksportu", new Date().toISOString()],
    ["Typ dokumentu", options.extraction.documentType],
    ["Urządzenie / źródło", options.extraction.sourceDevice ?? "Nie rozpoznano"],
    ["Język", options.extraction.language],
    ["Liczba wierszy", options.rows.length],
    ["Status kontroli", options.verified ? "Zweryfikowano przez użytkownika" : "WYMAGA WERYFIKACJI"],
    ["Ostrzeżenia", options.extraction.warnings.join(" | ") || "Brak"],
    [
      "Zasada",
      "Odczyt AI jest transkrypcją pomocniczą i nie zastępuje procedur kontroli laboratoryjnej.",
    ],
  ];

  sheet.addRows([["Pole", "Wartość"], ...metadata]);
  sheet.columns = [{ width: 26 }, { width: 88 }];
  styleHeaderRow(sheet.getRow(1));
  sheet.getColumn(2).alignment = { vertical: "top", wrapText: true };
}

function applyMappingRule(
  workbook: ExcelJS.Workbook,
  rows: LabResultRow[],
  rule: MappingRule,
): void {
  const sheetName = safeSheetName(rule.targetSheet);
  const sheet = workbook.getWorksheet(sheetName) ?? workbook.addWorksheet(sheetName);
  const reference = rule.startCell.trim().toUpperCase();
  if (!CELL_REFERENCE.test(reference)) {
    throw new Error(`Nieprawidłowa komórka początkowa: ${rule.startCell}`);
  }

  const origin = sheet.getCell(reference);
  let offset = 0;

  if (rule.includeHeader) {
    origin.value = LAB_FIELD_LABELS[rule.sourceField];
    origin.font = { bold: true, color: { argb: "FFFFFFFF" } };
    origin.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2C6A70" },
    };
    offset = 1;
  }

  rows.forEach((row, index) => {
    const rowOffset = rule.direction === "down" ? index + offset : 0;
    const columnOffset = rule.direction === "right" ? index + offset : 0;
    const cell = sheet.getCell(origin.row + rowOffset, origin.col + columnOffset);
    cell.value = normalizeCellValue(row[rule.sourceField]);
  });
}

export async function buildWorkbook(
  options: WorkbookExportOptions,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LabFlow OCR";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = false;

  if (options.templateFile) {
    const templateBuffer = await options.templateFile.arrayBuffer();
    await workbook.xlsx.load(templateBuffer);
  }

  populateRawSheet(workbook, options.rows);
  populateMetadataSheet(workbook, options);
  options.mappings.forEach((rule) => applyMappingRule(workbook, options.rows, rule));

  return workbook;
}

export async function createWorkbookBuffer(
  options: WorkbookExportOptions,
): Promise<ArrayBuffer> {
  const workbook = await buildWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export async function downloadWorkbook(
  options: WorkbookExportOptions,
  outputName: string,
): Promise<void> {
  const buffer = await createWorkbookBuffer(options);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = outputName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
