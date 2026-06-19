# LabFlow OCR

LabFlow to aplikacja webowa do przepisywania wyników laboratoryjnych ze zdjęć do plików Excel. Użytkownik wkleja zdjęcie lub wybiera je z dysku, sprawdza dane odczytane przez Gemini, a następnie zapisuje wskazane kolumny do wybranych arkuszy i komórek.

## Funkcje

- wklejanie obrazu ze schowka, przeciąganie pliku i wybór z dysku,
- odczyt tabel, wydruków urządzeń i kart wyników przez Gemini,
- logowanie e-mailem i hasłem przez Firebase Authentication,
- edycja oraz kontrola pewności każdego wyniku przed eksportem,
- eksport do nowego skoroszytu albo własnego szablonu `.xlsx`,
- reguły kopiowania kolumn do dowolnych arkuszy i komórek,
- osobny arkusz surowych danych i metadanych dla odtwarzalności.

## Architektura i bezpieczeństwo

Aplikacja używa Firebase AI Logic i modelu `gemini-3.5-flash`. Klucz Gemini nie znajduje się w kodzie ani w repozytorium — jest przechowywany w konfiguracji projektu Firebase. Wywołania AI wymagają zalogowanego użytkownika, nowe rejestracje są zablokowane, a aplikacja korzysta również z Firebase App Check z reCAPTCHA Enterprise.

Konfiguracja Firebase widoczna w kodzie przeglądarki jest publicznym identyfikatorem aplikacji, a nie sekretem. Dostęp do usług jest ograniczony po stronie Firebase.

## Uruchomienie lokalne

Wymagany jest Node.js 22 lub nowszy.

```powershell
npm.cmd install
npm.cmd run dev
```

Testy i kompilacja:

```powershell
npm.cmd test
npm.cmd run build
```

## Wdrożenie

Projekt Firebase: `labflow-ocr-pangalganek-2026`.

```powershell
firebase.cmd login
npm.cmd run deploy
```

Model ma limit bezpłatnych użyć zależny od aktualnych zasad Google. Przekroczenie limitu może wymagać poczekania na jego odnowienie albo włączenia rozliczeń.

## Ważne

Odczyt AI jest propozycją wymagającą kontroli człowieka. LabFlow nie interpretuje wyników medycznie i nie zastępuje procedur laboratoryjnych. Do aplikacji nie należy wysyłać danych, których przetwarzanie przez usługę AI jest niedozwolone przez zasady danego laboratorium.
