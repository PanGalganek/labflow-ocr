export type ResultFlag = "normal" | "low" | "high" | "critical" | "unknown";

export type LabResultRow = {
  id: string;
  sampleId: string | null;
  testDate: string | null;
  parameter: string;
  value: number | string | null;
  unit: string | null;
  referenceRange: string | null;
  flag: ResultFlag;
  notes: string | null;
  confidence: number;
  sourceText: string | null;
};

export type ExtractedRow = Omit<LabResultRow, "id">;

export type ExtractionResponse = {
  documentType: string;
  sourceDevice: string | null;
  language: string;
  warnings: string[];
  rows: ExtractedRow[];
};

export type LabField = Exclude<keyof LabResultRow, "id">;

export type MappingRule = {
  id: string;
  sourceField: LabField;
  targetSheet: string;
  startCell: string;
  direction: "down" | "right";
  includeHeader: boolean;
};

export type SourceImage = {
  file: File;
  dataUrl: string;
  previewUrl: string;
};

export const LAB_FIELD_LABELS: Record<LabField, string> = {
  sampleId: "Identyfikator próbki",
  testDate: "Data badania",
  parameter: "Parametr",
  value: "Wartość",
  unit: "Jednostka",
  referenceRange: "Zakres referencyjny",
  flag: "Flaga",
  notes: "Uwagi",
  confidence: "Pewność odczytu",
  sourceText: "Tekst źródłowy",
};

export const LAB_FIELDS = Object.keys(LAB_FIELD_LABELS) as LabField[];

export const DEFAULT_MAPPING_RULES: MappingRule[] = [
  {
    id: "default-sample",
    sourceField: "sampleId",
    targetSheet: "Do analizy",
    startCell: "A1",
    direction: "down",
    includeHeader: true,
  },
  {
    id: "default-parameter",
    sourceField: "parameter",
    targetSheet: "Do analizy",
    startCell: "B1",
    direction: "down",
    includeHeader: true,
  },
  {
    id: "default-value",
    sourceField: "value",
    targetSheet: "Do analizy",
    startCell: "C1",
    direction: "down",
    includeHeader: true,
  },
  {
    id: "default-unit",
    sourceField: "unit",
    targetSheet: "Do analizy",
    startCell: "D1",
    direction: "down",
    includeHeader: true,
  },
];
