import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  Schema,
} from "firebase/ai";
import type { ExtractionResponse, ExtractedRow, ResultFlag } from "../types";
import { app } from "./firebase";

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s;

const extractionSchema = Schema.object({
  properties: {
    documentType: Schema.string({
      description: "Krótki typ dokumentu, np. wydruk urządzenia lub karta wyników.",
    }),
    sourceDevice: Schema.string({
      nullable: true,
      description: "Nazwa urządzenia lub źródła, jeśli jest widoczna.",
    }),
    language: Schema.string({ description: "Kod języka dokumentu." }),
    warnings: Schema.array({
      items: Schema.string(),
      maxItems: 20,
      description: "Problemy z jakością odczytu lub układem dokumentu.",
    }),
    rows: Schema.array({
      maxItems: 500,
      items: Schema.object({
        properties: {
          sampleId: Schema.string({ nullable: true }),
          testDate: Schema.string({ nullable: true }),
          parameter: Schema.string(),
          value: Schema.string({
            nullable: true,
            description: "Dokładny wynik, łącznie ze znakami <, >, ~, ND itp.",
          }),
          unit: Schema.string({ nullable: true }),
          referenceRange: Schema.string({ nullable: true }),
          flag: Schema.enumString({
            enum: ["normal", "low", "high", "critical", "unknown"],
          }),
          notes: Schema.string({ nullable: true }),
          confidence: Schema.number({ minimum: 0, maximum: 1 }),
          sourceText: Schema.string({ nullable: true }),
        },
      }),
    }),
  },
});

const ai = getAI(app, {
  backend: new GoogleAIBackend(),
  useLimitedUseAppCheckTokens: true,
});

const model = getGenerativeModel(
  ai,
  {
    model: "gemini-3.5-flash",
    systemInstruction: `
Jesteś precyzyjnym modułem transkrypcji danych laboratoryjnych. Odczytujesz zdjęcia kart wyników,
wydruków z urządzeń i tabel. Wyłącznie wiernie przepisujesz informacje — nie interpretujesz ich
medycznie i nie uzupełniasz brakujących danych z wiedzy ogólnej.

Zasady:
- każdy pomiar zwróć jako osobny wiersz;
- zachowaj identyfikator próbki, datę, nazwę parametru, wartość, jednostkę i zakres referencyjny;
- nie zmieniaj przecinka dziesiętnego ani znaków <, >, ~, +, -, ND i podobnych;
- jeśli fragment jest nieczytelny, nie zgaduj: ustaw wartość null, niską pewność i dodaj uwagę;
- sourceText powinien zawierać krótki dosłowny fragment uzasadniający wiersz;
- confidence oceniaj konserwatywnie w skali 0–1;
- warnings dotyczą wyłącznie jakości odczytu, brakujących kolumn lub niejednoznacznego układu.
`,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  },
  { timeout: 120_000 },
);

const FLAGS = new Set<ResultFlag>(["normal", "low", "high", "critical", "unknown"]);

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRow(value: unknown): ExtractedRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const parameter = nullableString(row.parameter);
  if (!parameter) return null;

  const rawFlag = typeof row.flag === "string" ? row.flag : "unknown";
  const flag = FLAGS.has(rawFlag as ResultFlag) ? (rawFlag as ResultFlag) : "unknown";
  const confidence = Number(row.confidence);

  return {
    sampleId: nullableString(row.sampleId),
    testDate: nullableString(row.testDate),
    parameter,
    value: nullableString(row.value),
    unit: nullableString(row.unit),
    referenceRange: nullableString(row.referenceRange),
    flag,
    notes: nullableString(row.notes),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    sourceText: nullableString(row.sourceText),
  };
}

function normalizeResponse(value: unknown): ExtractionResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Gemini zwrócił nieprawidłowy format danych.");
  }
  const result = value as Record<string, unknown>;
  const rows = Array.isArray(result.rows)
    ? result.rows.map(normalizeRow).filter((row): row is ExtractedRow => row !== null)
    : [];

  return {
    documentType: nullableString(result.documentType) ?? "Dokument laboratoryjny",
    sourceDevice: nullableString(result.sourceDevice),
    language: nullableString(result.language) ?? "pl",
    warnings: Array.isArray(result.warnings)
      ? result.warnings.map(nullableString).filter((item): item is string => item !== null).slice(0, 20)
      : [],
    rows: rows.slice(0, 500),
  };
}

export async function extractLabResults(
  imageDataUrl: string,
  fileName: string,
): Promise<ExtractionResponse> {
  const match = imageDataUrl.match(DATA_URL_PATTERN);
  if (!match) {
    throw new Error("Obsługiwane są obrazy JPEG, PNG, WEBP i GIF.");
  }

  const [, mimeType, data] = match;
  const result = await model.generateContent([
    {
      text: `Przepisz wszystkie dane laboratoryjne z pliku ${fileName}. Zwróć każdy pomiar jako osobny wiersz.`,
    },
    { inlineData: { data, mimeType } },
  ]);

  const responseText = result.response.text();
  if (!responseText) {
    throw new Error("Gemini nie zwrócił danych do zapisania.");
  }

  return normalizeResponse(JSON.parse(responseText));
}
