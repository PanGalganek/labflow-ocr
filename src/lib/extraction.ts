import type { ExtractionResponse } from "../types";

export function mergeExtractions(
  items: Array<{ fileName: string; response: ExtractionResponse }>,
): ExtractionResponse {
  const devices = Array.from(
    new Set(items.map(({ response }) => response.sourceDevice).filter((item): item is string => Boolean(item))),
  );
  return {
    documentType:
      items.length === 1 ? items[0].response.documentType : `Zestaw ${items.length} dokumentów`,
    sourceDevice: devices.length ? devices.join(", ") : null,
    language: items[0]?.response.language ?? "pl",
    warnings: items.flatMap(({ fileName, response }) =>
      response.warnings.map((warning) => `${fileName}: ${warning}`),
    ),
    rows: items.flatMap(({ response }) => response.rows),
  };
}
