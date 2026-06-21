import ExcelJS from "exceljs";
import type { LabField, LabResultRow, MappingRule } from "../types";
import { LAB_FIELDS, LAB_FIELD_LABELS } from "../types";

const RAW_SHEET_NAME = "Dane surowe";
const FORMATTED_SHEET_NAME = "Dane dopasowane";
const INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;
const CELL_REFERENCE = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/i;

const COLUMN_WIDTHS: Record<LabField, number> = {
  sequenceNumber: 10,
  date: 16,
  blankSample: 18,
  controlSampleC1: 23,
  controlSampleC2: 23,
  repeatedSample1: 25,
  repeatedSample2: 25,
  range: 16,
};

export type WorkbookExportOptions = {
  rows: LabResultRow[];
  mappings: MappingRule[];
  templateFile?: File | null;
};

function safeSheetName(value: string): string {
  const sanitized = value.replace(INVALID_SHEET_CHARS, " ").trim().slice(0, 31);
  return sanitized || "Wyniki";
}

function getOrReplaceSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const existing = workbook.getWorksheet(name);
  if (existing) workbook.removeWorksheet(existing.id);
  return workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
}

function rawCellValue(value: LabResultRow[LabField]): string {
  return value === null || value === undefined ? "" : String(value);
}

function parseDateCell(value: string): Date | null {
  const isoMatch = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const polishMatch = value.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!isoMatch && !polishMatch) return null;
  const yearText = isoMatch?.[1] ?? polishMatch?.[3] ?? "";
  const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
  const month = Number(isoMatch?.[2] ?? polishMatch?.[2]);
  const day = Number(isoMatch?.[3] ?? polishMatch?.[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function formattedCellValue(value: LabResultRow[LabField], field: LabField): ExcelJS.CellValue {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (field === "date") return parseDateCell(text) ?? text;
  if (/^-?\d+(?:[.,]\d+)?$/.test(text)) {
    return Number(text.replace(",", "."));
  }
  return text;
}

function applyCellFormat(cell: ExcelJS.Cell, field: LabField): void {
  if (field === "date" && cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd";
  if (field !== "date" && typeof cell.value === "number") {
    cell.numFmt = field === "sequenceNumber" ? "0" : "0.############";
  }
}

function addFilterTable(
  sheet: ExcelJS.Worksheet,
  tableName: string,
  rows: LabResultRow[],
  mode: "raw" | "formatted",
): void {
  const table = sheet.addTable({
    name: tableName,
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: {
      theme: mode === "raw" ? "TableStyleMedium2" : "TableStyleMedium4",
      showRowStripes: true,
      showColumnStripes: false,
    },
    columns: LAB_FIELDS.map((field) => ({ name: LAB_FIELD_LABELS[field], filterButton: true })),
    rows: rows.map((row) =>
      LAB_FIELDS.map((field) =>
        mode === "raw" ? rawCellValue(row[field]) : formattedCellValue(row[field], field),
      ),
    ),
  });
  table.commit();

  LAB_FIELDS.forEach((field, index) => {
    sheet.getColumn(index + 1).width = COLUMN_WIDTHS[field];
  });

  for (let rowIndex = 2; rowIndex <= rows.length + 1; rowIndex += 1) {
    LAB_FIELDS.forEach((field, columnIndex) => {
      const cell = sheet.getCell(rowIndex, columnIndex + 1);
      if (mode === "raw") cell.numFmt = "@";
      else applyCellFormat(cell, field);
      cell.alignment = { vertical: "middle", horizontal: field === "sequenceNumber" ? "center" : "left" };
    });
  }
}

function populateCoreSheets(workbook: ExcelJS.Workbook, rows: LabResultRow[]): void {
  const rawSheet = getOrReplaceSheet(workbook, RAW_SHEET_NAME);
  addFilterTable(rawSheet, "LabFlowRawData", rows, "raw");

  const formattedSheet = getOrReplaceSheet(workbook, FORMATTED_SHEET_NAME);
  addFilterTable(formattedSheet, "LabFlowFormattedData", rows, "formatted");

  const orderedSheets = [rawSheet, formattedSheet, ...workbook.worksheets.filter(
    (sheet) => sheet !== rawSheet && sheet !== formattedSheet,
  )];
  orderedSheets.forEach((sheet, index) => {
    (sheet as ExcelJS.Worksheet & { orderNo: number }).orderNo = index;
  });
}

function applyMappingRule(
  workbook: ExcelJS.Workbook,
  rows: LabResultRow[],
  rule: MappingRule,
): void {
  const sheetName = safeSheetName(rule.targetSheet);
  if (sheetName === RAW_SHEET_NAME || sheetName === FORMATTED_SHEET_NAME) {
    throw new Error(`Arkusz „${sheetName}” jest tworzony automatycznie. Wybierz inną nazwę dla dodatkowej reguły.`);
  }
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
    origin.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C6A70" } };
    offset = 1;
  }

  rows.forEach((row, index) => {
    const rowOffset = rule.direction === "down" ? index + offset : 0;
    const columnOffset = rule.direction === "right" ? index + offset : 0;
    const cell = sheet.getCell(origin.row + rowOffset, origin.col + columnOffset);
    cell.value = formattedCellValue(row[rule.sourceField], rule.sourceField);
    applyCellFormat(cell, rule.sourceField);
  });
}

export async function buildWorkbook(options: WorkbookExportOptions): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LabFlow OCR";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = false;

  if (options.templateFile) {
    const templateBuffer = await options.templateFile.arrayBuffer();
    await workbook.xlsx.load(templateBuffer);
  }

  populateCoreSheets(workbook, options.rows);
  options.mappings.forEach((rule) => applyMappingRule(workbook, options.rows, rule));
  return workbook;
}

export async function createWorkbookBuffer(options: WorkbookExportOptions): Promise<ArrayBuffer> {
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
