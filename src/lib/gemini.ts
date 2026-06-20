import {
  FinishReason,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  Schema,
  ThinkingLevel,
  type Part,
} from "firebase/ai";
import type { ExtractionResponse, ExtractedRow } from "../types";
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
          sequenceNumber: Schema.string({ nullable: true, description: "Wartość z kolumny L.p." }),
          date: Schema.string({ nullable: true, description: "Wartość z kolumny Data." }),
          blankSample: Schema.string({ nullable: true, description: "Wartość z kolumny Próbka ślepa." }),
          controlSampleC1: Schema.string({ nullable: true, description: "Wartość z kolumny Próbka kontrolna c1." }),
          controlSampleC2: Schema.string({ nullable: true, description: "Wartość z kolumny Próbka kontrolna c2." }),
          repeatedSample1: Schema.string({ nullable: true, description: "Wartość z kolumny Próbka powtórzona (1)." }),
          repeatedSample2: Schema.string({ nullable: true, description: "Wartość z kolumny Próbka powtórzona (2)." }),
          range: Schema.string({ nullable: true, description: "Wartość z kolumny Rozstęp." }),
          notes: Schema.string({ nullable: true }),
          confidence: Schema.number({ minimum: 0, maximum: 1 }),
          sourceText: Schema.string({ nullable: true }),
        },
        optionalProperties: [
          "sequenceNumber",
          "date",
          "blankSample",
          "controlSampleC1",
          "controlSampleC2",
          "repeatedSample1",
          "repeatedSample2",
          "range",
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
- każdy fizyczny wiersz tabeli źródłowej zwróć jako jeden wiersz odpowiedzi;
- odczytuj dokładnie kolumny: L.p, Data, Próbka ślepa, Próbka kontrolna c1,
  Próbka kontrolna c2, Próbka powtórzona (1), Próbka powtórzona (2), Rozstęp;
- nie rozbijaj jednego wiersza tabeli na osobne pomiary;
- nie zmieniaj przecinka dziesiętnego ani znaków <, >, ~, +, -, ND i podobnych;
- jeśli fragment jest nieczytelny, nie zgaduj: ustaw wartość null, niską pewność i dodaj uwagę;
- sourceText dodaj tylko wtedy, gdy pomaga wyjaśnić niską pewność odczytu;
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
  { timeout: 240_000 },
);

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRow(value: unknown): ExtractedRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const normalizedValues = {
    sequenceNumber: nullableString(row.sequenceNumber),
    date: nullableString(row.date),
    blankSample: nullableString(row.blankSample),
    controlSampleC1: nullableString(row.controlSampleC1),
    controlSampleC2: nullableString(row.controlSampleC2),
    repeatedSample1: nullableString(row.repeatedSample1),
    repeatedSample2: nullableString(row.repeatedSample2),
    range: nullableString(row.range),
  };
  if (Object.values(normalizedValues).every((item) => item === null)) return null;

  const confidence = Number(row.confidence);

  return {
    ...normalizedValues,
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
  const request: Part[] = [
    {
      text: `Przepisz tabelę z pliku ${fileName}. Zachowaj jeden wiersz odpowiedzi na każdy wiersz tabeli oraz dokładnie przypisz osiem wskazanych kolumn. Pomijaj zbędne puste pola.`,
    },
    { inlineData: { data, mimeType } },
  ];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await model.generateContentStream(request);
      let responseText = "";
      let finishReason: string | undefined;

      for await (const chunk of result.stream) {
        responseText += chunk.text();
        finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
      }

      if (finishReason === FinishReason.MAX_TOKENS) {
        throw new Error("Dokument zawiera zbyt dużo danych na jeden odczyt. Podziel zdjęcie na dwie części.");
      }
      if (!responseText) {
        throw new Error("Gemini nie zwrócił danych do zapisania.");
      }

      return normalizeResponse(JSON.parse(responseText));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const interruptedTransfer =
        error instanceof SyntaxError ||
        /unexpected end|network|stream|aborted|\[503|service unavailable|temporarily unavailable/i.test(message);

      if (attempt === 0 && interruptedTransfer) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        continue;
      }
      if (message.startsWith("Dokument zawiera") || message.startsWith("Gemini nie zwrócił")) {
        throw error;
      }
      if (message.includes("[429") || /quota|rate limit/i.test(message)) {
        throw new Error("Wyczerpano chwilowy limit Gemini. Spróbuj ponownie za kilka minut.");
      }
      if (message.includes("[503") || /service unavailable|temporarily unavailable/i.test(message)) {
        throw new Error("Gemini jest chwilowo przeciążony. Spróbuj ponownie za minutę.");
      }
      if (message.includes("[401") || /unauthenticated|missing required authentication/i.test(message)) {
        throw new Error("Sesja wygasła. Wyloguj się i zaloguj ponownie.");
      }
      if (message.includes("[400") || /invalid argument/i.test(message)) {
        throw new Error("Gemini nie przyjął obrazu do analizy. Spróbuj użyć wyraźniejszego pliku JPEG lub PNG.");
      }
      if (interruptedTransfer) {
        throw new Error("Połączenie przerwało odbieranie wyników. Spróbuj ponownie lub podziel zdjęcie na dwie części.");
      }
      throw new Error("Nie udało się połączyć z Gemini. Spróbuj ponownie.");
    }
  }

  throw new Error("Nie udało się zakończyć odczytu obrazu.");
}
