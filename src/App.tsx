import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  ChevronRight,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  ImagePlus,
  LoaderCircle,
  PencilLine,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { extractLabResults } from "./lib/gemini";
import { mergeExtractions } from "./lib/extraction";
import {
  DEFAULT_MAPPING_RULES,
  LAB_FIELDS,
  LAB_FIELD_LABELS,
  type ExtractionResponse,
  type LabField,
  type LabResultRow,
  type MappingRule,
  type SourceImage,
} from "./types";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_COUNT = 10;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAPPING_STORAGE_KEY = "labflow:mapping-rules:v3";

const DEMO_EXTRACTION: ExtractionResponse = {
  documentType: "Karta powtarzalności metody",
  sourceDevice: null,
  language: "pl",
  warnings: ["Drugi wiersz ma lekko rozmazaną wartość — wymaga kontroli."],
  rows: [
    {
      sequenceNumber: "1",
      date: "18.06.2026",
      blankSample: "0,000",
      controlSampleC1: "0,103",
      controlSampleC2: "0,342",
      repeatedSample1: "0,347",
      repeatedSample2: "0,352",
      range: "0,005",
      notes: null,
      confidence: 0.98,
      sourceText: null,
    },
    {
      sequenceNumber: "2",
      date: "18.06.2026",
      blankSample: "0,001",
      controlSampleC1: "0,102",
      controlSampleC2: "0,341",
      repeatedSample1: "0,344",
      repeatedSample2: "0,349",
      range: "0,005",
      notes: "Sprawdź rozmazaną wartość na zdjęciu.",
      confidence: 0.78,
      sourceText: "wiersz 2",
    },
    {
      sequenceNumber: "3",
      date: "18.06.2026",
      blankSample: "0,000",
      controlSampleC1: "0,104",
      controlSampleC2: "0,339",
      repeatedSample1: "0,340",
      repeatedSample2: "0,344",
      range: "0,004",
      notes: null,
      confidence: 0.96,
      sourceText: null,
    },
  ],
};

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function rowsWithIds(response: ExtractionResponse): LabResultRow[] {
  return response.rows.map((row) => ({ ...row, id: makeId("row") }));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Nie udało się odczytać pliku."));
    reader.readAsDataURL(file);
  });
}

function loadStoredMappings(): MappingRule[] {
  try {
    const stored = localStorage.getItem(MAPPING_STORAGE_KEY);
    if (!stored) return DEFAULT_MAPPING_RULES;
    const parsed = JSON.parse(stored) as MappingRule[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_MAPPING_RULES;
  } catch {
    return DEFAULT_MAPPING_RULES;
  }
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.9) return "confidence confidence--high";
  if (confidence >= 0.75) return "confidence confidence--medium";
  return "confidence confidence--low";
}

function lowConfidenceMessage(count: number): string {
  if (count === 1) return "1 wynik ma obniżoną pewność. ";
  if (count >= 2 && count <= 4) return `${count} wyniki mają obniżoną pewność. `;
  return `${count} wyników ma obniżoną pewność. `;
}

function analysisErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.replace(/^Firebase:\s*/i, "") : "";
  if (/unexpected end of json|unterminated string in json|json.*position/i.test(message)) {
    return "Odpowiedź Gemini została przerwana. Uruchom odczyt ponownie; aplikacja ponowi transfer automatycznie.";
  }
  return message || "Nie udało się przeanalizować obrazu.";
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const [sourceImages, setSourceImages] = useState<SourceImage[]>([]);
  const [extraction, setExtraction] = useState<ExtractionResponse | null>(null);
  const [rows, setRows] = useState<LabResultRow[]>([]);
  const [mappings, setMappings] = useState<MappingRule[]>(loadStoredMappings);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mappings));
  }, [mappings]);

  const acceptFiles = useCallback(async (files: File[]) => {
    setError(null);
    if (!files.length) return;
    if (sourceImages.length + files.length > MAX_IMAGE_COUNT) {
      setError(`Możesz dodać maksymalnie ${MAX_IMAGE_COUNT} zdjęć do jednego odczytu.`);
      return;
    }
    for (const file of files) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setError(`${file.name}: wybierz obraz JPEG, PNG, WEBP lub GIF.`);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name}: plik przekracza limit 12 MB.`);
        return;
      }
    }

    try {
      const images = await Promise.all(
        files.map(async (file) => {
          const dataUrl = await readFileAsDataUrl(file);
          return { id: makeId("image"), file, dataUrl, previewUrl: dataUrl } satisfies SourceImage;
        }),
      );
      setSourceImages((current) => [...current, ...images]);
      setExtraction(null);
      setRows([]);
      setVerified(false);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Nie udało się odczytać pliku.");
    }
  }, [sourceImages.length]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) =>
        item.type.startsWith("image/"),
      );
      const file = imageItem?.getAsFile();
      if (file) {
        event.preventDefault();
        void acceptFiles([file]);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [acceptFiles]);

  const lowConfidenceCount = useMemo(
    () => rows.filter((row) => row.confidence < 0.85).length,
    [rows],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void acceptFiles(Array.from(event.dataTransfer.files));
  };

  const handleImageInput = (event: ChangeEvent<HTMLInputElement>) => {
    void acceptFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const removeSourceImage = (id: string) => {
    setSourceImages((current) => current.filter((image) => image.id !== id));
    setExtraction(null);
    setRows([]);
    setVerified(false);
  };

  const handleAnalyze = async () => {
    if (!sourceImages.length) return;
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setError(null);
    try {
      const results: Array<{ image: SourceImage; response: ExtractionResponse }> = [];
      for (let index = 0; index < sourceImages.length; index += 1) {
        const image = sourceImages[index];
        setAnalysisProgress(index + 1);
        try {
          const response = await extractLabResults(image.dataUrl, image.file.name);
          results.push({ image, response });
        } catch (analysisError) {
          throw new Error(`${image.file.name}: ${analysisErrorMessage(analysisError)}`);
        }
      }
      const response = mergeExtractions(
        results.map(({ image, response: itemResponse }) => ({
          fileName: image.file.name,
          response: itemResponse,
        })),
      );
      setExtraction(response);
      setRows(rowsWithIds(response));
      setVerified(false);
    } catch (analysisError) {
      setError(analysisErrorMessage(analysisError));
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(0);
    }
  };

  const loadDemo = () => {
    setExtraction(DEMO_EXTRACTION);
    setRows(rowsWithIds(DEMO_EXTRACTION));
    setVerified(false);
    setError(null);
  };

  const updateRow = <K extends keyof LabResultRow>(
    rowId: string,
    field: K,
    value: LabResultRow[K],
  ) => {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
    setVerified(false);
  };

  const addRow = () => {
    setRows((current) => [
      ...current,
      {
        id: makeId("row"),
        sequenceNumber: null,
        date: current.at(-1)?.date ?? null,
        blankSample: null,
        controlSampleC1: null,
        controlSampleC2: null,
        repeatedSample1: null,
        repeatedSample2: null,
        range: null,
        notes: null,
        confidence: 1,
        sourceText: null,
      },
    ]);
    setVerified(false);
  };

  const addMapping = () => {
    setMappings((current) => [
      ...current,
      {
        id: makeId("mapping"),
        sourceField: "sequenceNumber",
        targetSheet: "Dodatkowy arkusz",
        startCell: "A1",
        direction: "down",
        includeHeader: true,
      },
    ]);
  };

  const updateMapping = <K extends keyof MappingRule>(
    id: string,
    field: K,
    value: MappingRule[K],
  ) => {
    setMappings((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, [field]: value } : rule)),
    );
  };

  const handleExport = async () => {
    if (!rows.length || !extraction || !verified) return;
    setIsExporting(true);
    setError(null);
    try {
      const { downloadWorkbook } = await import("./lib/excel");
      const date = new Date().toISOString().slice(0, 10);
      await downloadWorkbook(
        {
          rows,
          mappings,
          templateFile,
        },
        `labflow-wyniki-${date}.xlsx`,
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Nie udało się utworzyć pliku Excel.");
    } finally {
      setIsExporting(false);
    }
  };

  const reset = () => {
    setSourceImages([]);
    setExtraction(null);
    setRows([]);
    setTemplateFile(null);
    setVerified(false);
    setError(null);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand__mark"><Beaker size={22} strokeWidth={2.3} /></div>
          <div>
            <strong>LabFlow</strong>
            <span>OCR do Excela</span>
          </div>
        </div>
        <div className="status-pill">
          <span className="status-pill__dot" />
          Gemini 3.5 Flash
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero__eyebrow"><Sparkles size={15} /> Asystent transkrypcji laboratoryjnej</div>
          <h1>Z kartki i urządzenia<br />prosto do <em>Excela.</em></h1>
          <p>
            Wklej jedno lub kilka zdjęć wyników, sprawdź odczytane wartości i zapisz je dokładnie
            w wybranych arkuszach oraz komórkach.
          </p>
        </section>

        <nav className="steps" aria-label="Etapy pracy">
          <div className={`step ${sourceImages.length || rows.length ? "step--done" : "step--active"}`}>
            <span>1</span><div><strong>Dodaj zdjęcia</strong><small>Do 10 plików</small></div>
          </div>
          <ChevronRight size={18} />
          <div className={`step ${rows.length ? "step--active" : ""}`}>
            <span>2</span><div><strong>Sprawdź dane</strong><small>Kontrola człowieka</small></div>
          </div>
          <ChevronRight size={18} />
          <div className={`step ${verified ? "step--active" : ""}`}>
            <span>3</span><div><strong>Eksportuj</strong><small>Reguły Excela</small></div>
          </div>
        </nav>

        {error && (
          <div className="alert alert--error" role="alert">
            <AlertTriangle size={19} />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Zamknij"><X size={17} /></button>
          </div>
        )}

        {!rows.length && (
          <section className="capture-grid">
            <div
              className={`drop-zone ${isDragging ? "drop-zone--dragging" : ""} ${sourceImages.length ? "drop-zone--filled" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              {sourceImages.length ? (
                <>
                  <div className="image-preview-grid">
                    {sourceImages.slice(0, 4).map((image) => <img key={image.id} src={image.previewUrl} alt={`Podgląd ${image.file.name}`} />)}
                    {sourceImages.length > 4 && <span className="image-preview-more">+{sourceImages.length - 4}</span>}
                  </div>
                  <div className="image-overlay image-overlay--multi">
                    <div className="image-overlay__summary"><CheckCircle2 size={20} /><span><strong>{sourceImages.length} {sourceImages.length === 1 ? "zdjęcie" : sourceImages.length < 5 ? "zdjęcia" : "zdjęć"}</strong><small>{(sourceImages.reduce((sum, image) => sum + image.file.size, 0) / 1024 / 1024).toFixed(2)} MB łącznie</small></span></div>
                    <button type="button" className="button button--secondary button--small" onClick={() => inputRef.current?.click()}><Plus size={15} /> Dodaj kolejne</button>
                    <div className="image-file-list">
                      {sourceImages.map((image) => (
                        <div className="image-file-item" key={image.id}><span title={image.file.name}>{image.file.name}</span><button type="button" onClick={() => removeSourceImage(image.id)} aria-label={`Usuń ${image.file.name}`}><X size={14} /></button></div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="drop-zone__content">
                  <div className="drop-zone__icon"><ImagePlus size={34} /></div>
                  <h2>Wklej lub upuść zdjęcia</h2>
                  <p>Naciśnij <kbd>Ctrl</kbd> + <kbd>V</kbd> albo przeciągnij kilka plików tutaj</p>
                  <div className="divider"><span>lub</span></div>
                  <button type="button" className="button button--secondary" onClick={() => inputRef.current?.click()}>
                    <UploadCloud size={18} /> Wybierz zdjęcia
                  </button>
                  <small>Do {MAX_IMAGE_COUNT} zdjęć · maks. 12 MB każde</small>
                </div>
              )}
              <input ref={inputRef} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleImageInput} />
            </div>

            <aside className="capture-aside">
              <div className="aside-card aside-card--accent">
                <ClipboardPaste size={23} />
                <div><strong>Najszybciej ze schowka</strong><p>Zrób zrzut ekranu wyniku i od razu wciśnij Ctrl+V.</p></div>
              </div>
              <div className="aside-card">
                <ShieldCheck size={23} />
                <div><strong>Kontrola przed zapisem</strong><p>Każdy odczyt możesz poprawić. Niepewne pola są oznaczone.</p></div>
              </div>
              <div className="aside-card">
                <FileSpreadsheet size={23} />
                <div><strong>Dwa gotowe arkusze</strong><p>Surowy odczyt oraz dane dopasowane do typów dat i liczb, oba z filtrami.</p></div>
              </div>
              <button type="button" className="demo-link" onClick={loadDemo}>Zobacz przykładowy odczyt <ChevronRight size={15} /></button>
            </aside>
          </section>
        )}

        {sourceImages.length > 0 && !rows.length && (
          <div className="action-bar">
            <div><Sparkles size={21} /><span><strong>{sourceImages.length === 1 ? "Obraz gotowy" : `${sourceImages.length} obrazów gotowych`} do analizy</strong><small>Każde zdjęcie zostanie odczytane osobno, a wyniki połączone.</small></span></div>
            <button type="button" className="button button--primary" onClick={handleAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? <LoaderCircle className="spin" size={19} /> : <Sparkles size={18} />}
              {isAnalyzing ? `Odczytuję ${analysisProgress}/${sourceImages.length}…` : "Odczytaj wyniki"}
            </button>
          </div>
        )}

        {rows.length > 0 && extraction && (
          <>
            <section className="results-section">
              <div className="section-heading">
                <div>
                  <span className="section-kicker"><Table2 size={16} /> Krok 2</span>
                  <h2>Sprawdź odczytane dane</h2>
                  <p>{extraction.documentType}{extraction.sourceDevice ? ` · ${extraction.sourceDevice}` : ""}</p>
                </div>
                <button type="button" className="button button--ghost" onClick={reset}><RotateCcw size={17} /> Nowy odczyt</button>
              </div>

              {(extraction.warnings.length > 0 || lowConfidenceCount > 0) && (
                <div className="alert alert--warning">
                  <AlertTriangle size={19} />
                  <span>
                    <strong>Sprawdź oznaczone pola.</strong>{" "}
                    {lowConfidenceCount > 0 ? lowConfidenceMessage(lowConfidenceCount) : ""}
                    {extraction.warnings.join(" ")}
                  </span>
                </div>
              )}

              <div className="table-wrap">
                <table className="results-table">
                  <thead><tr><th>L.p</th><th>Data</th><th>Próbka ślepa</th><th>Próbka kontrolna c1</th><th>Próbka kontrolna c2</th><th>Próbka powtórzona (1)</th><th>Próbka powtórzona (2)</th><th>Rozstęp</th><th>Pewność</th><th aria-label="Akcje" /></tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={row.confidence < 0.85 ? "row--check" : ""}>
                        <td><input aria-label="L.p" value={row.sequenceNumber ?? ""} onChange={(event) => updateRow(row.id, "sequenceNumber", event.target.value || null)} /></td>
                        <td><input aria-label="Data" value={row.date ?? ""} onChange={(event) => updateRow(row.id, "date", event.target.value || null)} /></td>
                        <td><input aria-label="Próbka ślepa" value={row.blankSample ?? ""} onChange={(event) => updateRow(row.id, "blankSample", event.target.value || null)} /></td>
                        <td><input aria-label="Próbka kontrolna c1" value={row.controlSampleC1 ?? ""} onChange={(event) => updateRow(row.id, "controlSampleC1", event.target.value || null)} /></td>
                        <td><input aria-label="Próbka kontrolna c2" value={row.controlSampleC2 ?? ""} onChange={(event) => updateRow(row.id, "controlSampleC2", event.target.value || null)} /></td>
                        <td><input aria-label="Próbka powtórzona (1)" value={row.repeatedSample1 ?? ""} onChange={(event) => updateRow(row.id, "repeatedSample1", event.target.value || null)} /></td>
                        <td><input aria-label="Próbka powtórzona (2)" value={row.repeatedSample2 ?? ""} onChange={(event) => updateRow(row.id, "repeatedSample2", event.target.value || null)} /></td>
                        <td><input aria-label="Rozstęp" value={row.range ?? ""} onChange={(event) => updateRow(row.id, "range", event.target.value || null)} /></td>
                        <td><span className={confidenceClass(row.confidence)}>{Math.round(row.confidence * 100)}%</span></td>
                        <td><button type="button" className="icon-button icon-button--quiet" onClick={() => { setRows((current) => current.filter((item) => item.id !== row.id)); setVerified(false); }} aria-label={`Usuń wiersz ${row.sequenceNumber ?? ""}`}><Trash2 size={16} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="add-row" onClick={addRow}><Plus size={16} /> Dodaj wiersz</button>
            </section>

            <section className="mapping-section">
              <div className="section-heading">
                <div>
                  <span className="section-kicker"><Settings2 size={16} /> Krok 3</span>
                  <h2>Eksport do Excela</h2>
                  <p>Arkusze „Dane surowe” i „Dane dopasowane” powstaną automatycznie z działającymi filtrami.</p>
                </div>
              </div>

              <div className="template-card">
                <div className="template-card__icon"><FileSpreadsheet size={24} /></div>
                <div><strong>Szablon Excel (opcjonalnie)</strong><p>Wgraj istniejący plik `.xlsx`, aby uzupełnić jego arkusze.</p></div>
                {templateFile ? (
                  <div className="file-chip"><span>{templateFile.name}</span><button type="button" onClick={() => setTemplateFile(null)}><X size={14} /></button></div>
                ) : (
                  <button type="button" className="button button--secondary button--small" onClick={() => templateRef.current?.click()}>Wybierz szablon</button>
                )}
                <input ref={templateRef} className="visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setTemplateFile(event.target.files?.item(0) ?? null); event.target.value = ""; }} />
              </div>

              <div className="mapping-list">
                <div className="mapping-list__title"><strong>Dodatkowe kopiowanie</strong><span>Opcjonalnie skopiuj wybraną kolumnę do kolejnego arkusza lub szablonu.</span></div>
                {mappings.length > 0 && <div className="mapping-list__head"><span>Kolumna źródłowa</span><span>Arkusz docelowy</span><span>Od komórki</span><span>Kierunek</span><span>Nagłówek</span><span /></div>}
                {mappings.map((rule) => (
                  <div className="mapping-row" key={rule.id}>
                    <label><span>Kolumna</span><select value={rule.sourceField} onChange={(event) => updateMapping(rule.id, "sourceField", event.target.value as LabField)}>{LAB_FIELDS.map((field) => <option key={field} value={field}>{LAB_FIELD_LABELS[field]}</option>)}</select></label>
                    <label><span>Arkusz</span><input value={rule.targetSheet} onChange={(event) => updateMapping(rule.id, "targetSheet", event.target.value)} /></label>
                    <label><span>Komórka</span><input className="cell-input" value={rule.startCell} onChange={(event) => updateMapping(rule.id, "startCell", event.target.value.toUpperCase())} /></label>
                    <label><span>Kierunek</span><select value={rule.direction} onChange={(event) => updateMapping(rule.id, "direction", event.target.value as "down" | "right")}><option value="down">W dół</option><option value="right">W prawo</option></select></label>
                    <label className="switch-label"><span>Nagłówek</span><input type="checkbox" checked={rule.includeHeader} onChange={(event) => updateMapping(rule.id, "includeHeader", event.target.checked)} /><i /></label>
                    <button type="button" className="icon-button icon-button--quiet" onClick={() => setMappings((current) => current.filter((item) => item.id !== rule.id))} aria-label="Usuń regułę"><Trash2 size={16} /></button>
                  </div>
                ))}
                <button type="button" className="add-row" onClick={addMapping}><Plus size={16} /> Dodaj opcjonalną regułę</button>
              </div>

              <div className="verification-card">
                <label>
                  <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
                  <span className="verification-card__check"><CheckCircle2 size={18} /></span>
                  <span><strong>Sprawdziłem/-am wartości ze zdjęciem</strong><small>Eksport zostanie odblokowany po potwierdzeniu kontroli.</small></span>
                </label>
                <button type="button" className="button button--primary button--export" onClick={handleExport} disabled={!verified || isExporting}>
                  {isExporting ? <LoaderCircle className="spin" size={19} /> : <Download size={19} />}
                  {isExporting ? "Tworzę plik…" : "Pobierz Excel"}
                </button>
              </div>
            </section>
          </>
        )}

        <section className="quality-note">
          <PencilLine size={18} />
          <p><strong>Ważne:</strong> LabFlow przepisuje dane, ale ich nie interpretuje. Zawsze porównaj eksport ze źródłem przed dalszą analizą.</p>
        </section>
      </main>

      <footer><span>LabFlow OCR · prywatne narzędzie laboratoryjne</span><span>Dane obrazu są wysyłane wyłącznie do analizy na żądanie.</span></footer>
    </div>
  );
}

export default App;
