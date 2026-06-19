import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import OpenAI from "openai";

const openaiApiKey = defineSecret("OPENAI_API_KEY");

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/;

const LAB_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: { type: "string" },
    sourceDevice: { type: ["string", "null"] },
    language: { type: "string" },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sampleId: { type: ["string", "null"] },
          testDate: { type: ["string", "null"] },
          parameter: { type: "string" },
          value: { type: ["number", "string", "null"] },
          unit: { type: ["string", "null"] },
          referenceRange: { type: ["string", "null"] },
          flag: {
            type: "string",
            enum: ["normal", "low", "high", "critical", "unknown"],
          },
          notes: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          sourceText: { type: ["string", "null"] },
        },
        required: [
          "sampleId",
          "testDate",
          "parameter",
          "value",
          "unit",
          "referenceRange",
          "flag",
          "notes",
          "confidence",
          "sourceText"
        ],
      },
    },
  },
  required: ["documentType", "sourceDevice", "language", "warnings", "rows"],
} as const;

const EXTRACTION_INSTRUCTIONS = `
Jesteś precyzyjnym modułem transkrypcji danych laboratoryjnych. Odczytujesz zdjęcia kart wyników,
wydruków z urządzeń i tabel. Twoim zadaniem jest wyłącznie wierne przepisanie informacji — nie
interpretuj ich medycznie i nie uzupełniaj brakujących danych z wiedzy ogólnej.

Zasady:
- każdy pomiar zwróć jako osobny wiersz;
- zachowaj identyfikator próbki, datę, nazwę parametru, jednostkę i zakres referencyjny;
- przecinek dziesiętny możesz zamienić na liczbę JSON, ale nie zmieniaj wartości;
- znaki <, >, ~, +, -, ND i tekstowe wyniki zachowaj jako tekst;
- jeśli fragment jest nieczytelny, nie zgaduj: ustaw wartość null, niską pewność i opisz problem;
- sourceText powinien zawierać krótki dosłowny fragment, który uzasadnia dany wiersz;
- confidence oceniaj konserwatywnie w skali 0–1;
- ostrzeżenia dotyczą tylko jakości odczytu, brakujących kolumn albo niejednoznacznego układu.
`;

type ExtractionRequest = {
  imageDataUrl?: unknown;
  fileName?: unknown;
};

type ExtractedRow = {
  sampleId: string | null;
  testDate: string | null;
  parameter: string;
  value: number | string | null;
  unit: string | null;
  referenceRange: string | null;
  flag: "normal" | "low" | "high" | "critical" | "unknown";
  notes: string | null;
  confidence: number;
  sourceText: string | null;
};

type ExtractionResult = {
  documentType: string;
  sourceDevice: string | null;
  language: string;
  warnings: string[];
  rows: ExtractedRow[];
};

function validateDataUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "Brakuje obrazu do analizy.");
  }

  const match = value.match(DATA_URL_PATTERN);
  if (!match) {
    throw new HttpsError(
      "invalid-argument",
      "Obsługiwane są obrazy JPEG, PNG, WEBP i GIF.",
    );
  }

  const imageBytes = Buffer.from(match[2], "base64").byteLength;
  if (imageBytes === 0 || imageBytes > MAX_IMAGE_BYTES) {
    throw new HttpsError(
      "invalid-argument",
      "Obraz jest pusty albo przekracza limit 12 MB.",
    );
  }

  return value;
}

function normalizeResult(result: ExtractionResult): ExtractionResult {
  return {
    ...result,
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 20) : [],
    rows: Array.isArray(result.rows)
      ? result.rows.slice(0, 500).map((row) => ({
          ...row,
          parameter: String(row.parameter ?? "").trim(),
          confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
        }))
      : [],
  };
}

export const extractLabResults = onCall(
  {
    region: "europe-central2",
    memory: "1GiB",
    timeoutSeconds: 120,
    maxInstances: 5,
    secrets: [openaiApiKey],
  },
  async (request) => {
    const payload = (request.data ?? {}) as ExtractionRequest;
    const imageDataUrl = validateDataUrl(payload.imageDataUrl);
    const fileName =
      typeof payload.fileName === "string" ? payload.fileName.slice(0, 180) : "obraz";

    try {
      const client = new OpenAI({ apiKey: openaiApiKey.value() });
      const response = await client.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        instructions: EXTRACTION_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Przepisz wszystkie dane laboratoryjne z pliku: ${fileName}.`,
              },
              {
                type: "input_image",
                image_url: imageDataUrl,
                detail: "auto",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "lab_result_extraction",
            strict: true,
            schema: LAB_RESULT_SCHEMA,
          },
        },
      });

      if (!response.output_text) {
        throw new Error("Model nie zwrócił danych tekstowych.");
      }

      const result = normalizeResult(JSON.parse(response.output_text) as ExtractionResult);
      logger.info("Laboratory image processed", {
        fileName,
        rowCount: result.rows.length,
        warningCount: result.warnings.length,
      });

      return result;
    } catch (error) {
      logger.error("Laboratory image processing failed", {
        fileName,
        error: error instanceof Error ? error.message : "unknown error",
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      if (error instanceof OpenAI.APIError) {
        if (error.status === 429 && error.code === "insufficient_quota") {
          throw new HttpsError(
            "resource-exhausted",
            "Limit usługi AI został wyczerpany. Uzupełnij środki API OpenAI i spróbuj ponownie.",
          );
        }
        if (error.status === 429) {
          throw new HttpsError(
            "resource-exhausted",
            "Usługa AI jest chwilowo przeciążona. Odczekaj moment i spróbuj ponownie.",
          );
        }
        if (error.status === 401) {
          throw new HttpsError(
            "failed-precondition",
            "Konfiguracja usługi AI jest nieprawidłowa. Skontaktuj się z administratorem aplikacji.",
          );
        }
      }

      throw new HttpsError(
        "internal",
        "Nie udało się odczytać obrazu. Spróbuj ponownie lub użyj wyraźniejszego zdjęcia.",
      );
    }
  },
);
