import ExcelJS from "exceljs";
import type {
  LabField,
  LabResultRow,
  MappingRule,
} from "../types";
import { LAB_FIELD_LABELS } from "../types";

const RAW_SHEET_NAME = "Dane surowe";
const INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;
const CELL_REFERENCE = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/i;

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
  if (existing) {
    workbook.removeWorksheet(existing.id);
  }
  return workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
}

function parseDateCell(value: string): Date | null {
  const isoMatch = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const polishMatch = value.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!isoMatch && !polishMatch) return null;
  const yearText = isoMatch?.[1] ?? polishMatch?.[3] ?? "";
  const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
  const month = Number(isoMatch?.[2] ?? polishMatch?.[2]);
  const day = Number(isoMatch?.[3] ?? polishMatch?.[1]);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCellValue(value: LabResultRow[LabField], field: LabField): ExcelJS.CellValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value).trim();
  if (field === "date") return parseDateCell(text) ?? text;
  if (field !== "sequenceNumber" && /^-?\d+(?:[.,]\d+)?$/.test(text)) {
    return Number(text.replace(",", "."));
  }
  return text;
}

function applyCellFormat(cell: ExcelJS.Cell, field: LabField): void {
  if (field === "date" && cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd";
  if (field !== "sequenceNumber" && field !== "date" && typeof cell.value === "number") {
    cell.numFmt = "0.############";
  }
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
  ];

  rows.forEach((row) => {
    const excelRow = sheet.addRow(
      Object.fromEntries(
        (Object.keys(LAB_FIELD_LABELS) as LabField[]).map((field) => [
          field,
          normalizeCellValue(row[field], field),
        ]),
      ),
    );
    (Object.keys(LAB_FIELD_LABELS) as LabField[]).forEach((field) => {
      applyCellFormat(excelRow.getCell(field), field);
    });
  });

  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: "A1", to: "H1" };
  sheet.eachRow((row, index) => {
    if (index > 1) {
      row.alignment = { vertical: "top", wrapText: true };
    }
  });
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
    cell.value = normalizeCellValue(row[rule.sourceField], rule.sourceField);
    applyCellFormat(cell, rule.sourceField);
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
