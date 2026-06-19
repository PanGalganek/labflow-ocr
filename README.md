# LabFlow OCR

Prywatna aplikacja webowa do przenoszenia wyników laboratoryjnych ze zdjęć do plików Excel. Użytkownik wkleja lub wybiera zdjęcie, sprawdza odczytane dane, a następnie eksportuje je według reguł wskazujących arkusz i komórkę docelową.

## Funkcje

- wklejanie obrazu ze schowka, przeciąganie pliku i wybór z dysku,
- rozpoznawanie tabel, wydruków urządzeń i odręcznych kart przez OpenAI,
- edycja i kontrola pewności każdego wyniku przed eksportem,
- eksport do nowego skoroszytu albo do własnego szablonu `.xlsx`,
- reguły kopiowania kolumn do dowolnych arkuszy i komórek,
- osobny arkusz surowych danych i metadanych dla odtwarzalności.

## Uruchomienie lokalne

```powershell
npm.cmd install
npm.cmd --prefix functions install
npm.cmd run build:all
firebase.cmd emulators:start
```

Sekret `OPENAI_API_KEY` jest przechowywany lokalnie w `.env.local`, a na Firebase w Secret Manager. Nie może być zmienną `VITE_*` ani trafić do repozytorium.

## Wdrożenie

Projekt Firebase: `labflow-ocr-pangalganek-2026`.

Funkcje chmurowe i Secret Manager wymagają planu Firebase Blaze. Po jego aktywowaniu:

```powershell
firebase.cmd functions:secrets:set OPENAI_API_KEY
npm.cmd run deploy
```

Konto OpenAI API musi mieć aktywne rozliczenia lub dostępne środki. Subskrypcja ChatGPT nie zasila osobno rozliczanego API.

## Bezpieczeństwo danych

Odczyt AI jest propozycją wymagającą kontroli człowieka. Aplikacja nie interpretuje wyników medycznie i nie zastępuje procedur laboratoryjnych. Przed użyciem produkcyjnym należy skonfigurować Firebase App Check oraz retencję danych zgodną z zasadami laboratorium.
