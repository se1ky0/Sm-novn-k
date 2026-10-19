# Směnovník

Plánování směn pro mě, rodinu a tým – webová aplikace (PWA), funguje i offline a dá se nainstalovat na plochu telefonu.

- **Týden** – karta „Teď jsi v práci / Další směna“ s odpočtem, seznam dní se směnami (D = denní, N = noční, V = volno). Tahem prstu se přepíná týden.
- **Kalendář** – celý měsíc, počet směn a hodin, upozornění.
- **Tým** – kdo je teď v práci, rozpis kolegů na 7 dní dopředu a jejich změny hned, jak je udělají (vyžaduje jednorázové nastavení Firebase, viz níže).
- **Úprava dne** – klepnutím na den změníš směnu, upravíš její čas (např. zkrácená směna) a přidáš poznámku (Dovolená, Nemoc, Výměna).
- **Akce** – školení, porada, přesčas, lékař… s časem od–do, místem a popisem. Bez týmu jsou jen tvoje.
- **Kontroly** – pauza mezi směnami, max. hodin za cyklus, noční po sobě, souvislé volno; u rodiny upozornění, když mají všichni stejnou směnu.
- **Nastavení** – 14denní vzor, časy a barvy směn, lidé s posunem cyklu, světlý/tmavý vzhled, záloha do souboru.

Vlastní data se ukládají v prohlížeči daného zařízení. Do týmu se sdílí jen rozpis první osoby z Nastavení → Lidé (to jsi ty).

## Spuštění

Aplikace je jen statické soubory, žádná instalace ani build.

1. V GitHubu otevři **Settings → Pages**, jako zdroj zvol větev `main` a složku `/ (root)` a ulož.
2. Otevři adresu `https://<uživatel>.github.io/<repozitář>/` v telefonu.
3. **Android (Chrome):** menu ⋮ → *Přidat na plochu / Nainstalovat aplikaci*.
   **iPhone (Safari):** Sdílet → *Přidat na plochu*.

Lokálně: `python3 -m http.server` a otevři `http://localhost:8000`.

## Sdílení s týmem (Firebase, zdarma)

Dělá se jen jednou. Kolegové pak už jen otevřou pozvánku.

1. Otevři <https://console.firebase.google.com> → **Create a project / Přidat projekt** → název např. `smenovnik` → Google Analytics můžeš vypnout → vytvořit.
2. **Build → Authentication → Get started** → záložka **Sign-in method** → **Anonymous** → zapnout → **Save**.
3. **Build → Firestore Database → Create database** → umístění v Evropě (např. `eur3`) → **production mode** → vytvořit.
4. Ve Firestore otevři záložku **Rules**, smaž obsah, vlož celý soubor [`firestore.rules`](firestore.rules) a dej **Publish**.
5. Ozubené kolo → **Project settings** → dole **Your apps** → ikona **`</>`** (Web) → název `Směnovník` → **Register app** → zkopíruj blok `const firebaseConfig = { … }`.
6. Ten blok vlož do souboru [`firebase-config.js`](firebase-config.js) místo `null` (např. `window.SMENOVNIK_FIREBASE = { apiKey: "…", … };`).
   Jde to i bez úpravy souboru: v aplikaci **Tým → Jednorázové nastavení** blok vlož a ulož; pozvánka pak nastavení předá kolegům sama.

Pak v aplikaci: **Tým** → napiš své jméno → **Založit tým** → **Pozvat kolegy** (pošle odkaz s kódem týmu).

### Mistr a pracovníci

- Kdo tým založí, je **mistr**. Další mistry určí v **Tým → Členové → Udělat mistrem**.
- Mistr zadává **akce pro tým** (školení, porady, přesčasy…): klepne na den → *Přidat akci*, vyplní čas, místo a popis a vybere, pro koho akce je (celý tým nebo vybraní lidé).
- Pracovníci akci dostanou hned (hlášení, odznak, karta *Čeká na tvou odpověď*) a jen odpoví **Přijdu / Možná / Nepřijdu** s poznámkou. Mistr vidí odpovědi všech i to, jakou má kdo ten den směnu.
- Tým založený starší verzí aplikace mistra nemá – v záložce Tým si ho jeden člověk převezme tlačítkem *Jsem mistr*.
- Pravidla ve `firestore.rules` hlídají, že akce zadávají a mažou jen mistři a každý mění jen svůj záznam. Po změně pravidel je nahraj znovu (Firestore → Rules → Publish, nebo `firebase deploy --only firestore:rules`).

- Kdo zná kód týmu, vidí jeho směny a akce. Každý může měnit jen svůj vlastní záznam; seznam týmů nejde vypsat.
- Upozornění na změny kolegů se ukazují v aplikaci (odznak na záložce Tým a hlášení), ne jako notifikace při zavřené aplikaci.
- Bezplatný tarif Firebase (Spark) na tým bohatě stačí.

## Nová verze

Stránka se načítá nejdřív ze sítě, takže změny jsou vidět hned. Ostatní soubory se aktualizují na pozadí a projeví se při dalším otevření. Při větší změně zvyš v `sw.js` hodnotu `VERZE`.
