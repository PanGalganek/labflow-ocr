import {
  FinishReason,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  Schema,
  ThinkingLevel,
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
      // Gemini 3.5 Flash odrzuca maxItems=500 jako nieprawidłowy argument.
      // Limit jest egzekwowany po stronie aplikacji w normalizeResponse.
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
        optionalProperties: [
          "sampleId",
          "testDate",
          "value",
          "unit",
          "referenceRange",
          "notes",
          "sourceText",
        ],
      }),
    }),
  },
  optionalProperties: ["sourceDevice"],
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
- jeśli zdjęcie jest obrócone, odczytaj dokument po uwzględnieniu właściwej orientacji;
- warnings dotyczą wyłącznie jakości odczytu, brakujących kolumn lub niejednoznacznego układu.
`,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
      temperature: 0.1,
      maxOutputTokens: 65_536,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
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
  let result;
  try {
    result = await model.generateContent([
      {
        text: `Przepisz wszystkie dane laboratoryjne z pliku ${fileName}. Zwróć każdy pomiar jako osobny wiersz.`,
      },
      { inlineData: { data, mimeType } },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("[429") || /quota|rate limit/i.test(message)) {
      throw new Error("Wyczerpano chwilowy limit Gemini. Spróbuj ponownie za kilka minut.");
    }
    if (message.includes("[401") || /unauthenticated|missing required authentication/i.test(message)) {
      throw new Error("Sesja wygasła. Wyloguj się i zaloguj ponownie.");
    }
    if (message.includes("[400") || /invalid argument/i.test(message)) {
      throw new Error("Gemini nie przyjął obrazu do analizy. Spróbuj użyć wyraźniejszego pliku JPEG lub PNG.");
    }
    throw new Error("Nie udało się połączyć z Gemini. Spróbuj ponownie.");
  }

  const finishReason = result.response.candidates?.[0]?.finishReason;
  if (finishReason === FinishReason.MAX_TOKENS) {
    throw new Error("Dokument zawiera zbyt dużo danych na jeden odczyt. Podziel zdjęcie na dwie części.");
  }

  const responseText = result.response.text();
  if (!responseText) {
    throw new Error("Gemini nie zwrócił danych do zapisania.");
  }

  try {
    return normalizeResponse(JSON.parse(responseText));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Gemini zwrócił niepełne dane. Spróbuj ponownie odczytać zdjęcie.");
    }
    throw error;
  }
}
