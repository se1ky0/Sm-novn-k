# Směnovník

Plánování směn pro mě a rodinu – webová aplikace (PWA), funguje i offline a dá se nainstalovat na plochu telefonu.

- **Týden / 14 dní** – přehled směn (D = denní, N = noční, V = volno), další směna, součet hodin.
- **Úprava dne** – klepnutím na den změníš směnu a přidáš poznámku (výměna, dovolená…).
- **Kontroly** – pauza mezi směnami, max. hodin za cyklus, noční po sobě, souvislé volno; u více lidí upozornění, když mají stejnou směnu.
- **Nastavení** – 14denní vzor, časy a barvy směn, lidé s posunem cyklu, světlý/tmavý vzhled, záloha přes JSON.

Data se ukládají jen v prohlížeči daného zařízení (localStorage).

## Spuštění

Aplikace je jen statické soubory, žádná instalace ani build.

1. V GitHubu otevři **Settings → Pages**, jako zdroj zvol větev a složku `/ (root)` a ulož.
2. Otevři adresu `https://<uživatel>.github.io/<repozitář>/` v telefonu.
3. **Android (Chrome):** menu ⋮ → *Přidat na plochu / Nainstalovat aplikaci*.
   **iPhone (Safari):** Sdílet → *Přidat na plochu*.

Lokálně: `python3 -m http.server` a otevři `http://localhost:8000`.

## Nová verze

Po změně souborů zvyš v `sw.js` hodnotu `VERZE` (např. `smenovnik-v2`), aby si telefon stáhl novou verzi místo té uložené v cache.
