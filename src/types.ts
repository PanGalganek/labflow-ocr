export type LabResultRow = {
  id: string;
  sequenceNumber: string | null;
  date: string | null;
  blankSample: string | null;
  controlSampleC1: string | null;
  controlSampleC2: string | null;
  repeatedSample1: string | null;
  repeatedSample2: string | null;
  range: string | null;
  confidence: number;
  notes: string | null;
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

export const LAB_FIELDS = [
  "sequenceNumber",
  "date",
  "blankSample",
  "controlSampleC1",
  "controlSampleC2",
  "repeatedSample1",
  "repeatedSample2",
  "range",
] as const;

export type LabField = (typeof LAB_FIELDS)[number];

export type MappingRule = {
  id: string;
  sourceField: LabField;
  targetSheet: string;
  startCell: string;
  direction: "down" | "right";
  includeHeader: boolean;
};

export type SourceImage = {
  id: string;
  file: File;
  dataUrl: string;
  previewUrl: string;
};

export const LAB_FIELD_LABELS: Record<LabField, string> = {
  sequenceNumber: "L.p",
  date: "Data",
  blankSample: "Próbka ślepa",
  controlSampleC1: "Próbka kontrolna c1",
  controlSampleC2: "próbka kontrolna c2",
  repeatedSample1: "próbka powtórzona (1)",
  repeatedSample2: "próbka powtórzona (2)",
  range: "Rozstęp",
};

export const DEFAULT_MAPPING_RULES: MappingRule[] = [];
