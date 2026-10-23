# SovereignMind – Produkt- und Download-Seite

Statische Seite ohne Build-Schritt, ausgeliefert über GitHub Pages.

| Seite | Inhalt |
| --- | --- |
| `index.html` | Produkt, Funktionen, Assistenten, Architektur, **Betrieb im Alltag** (Tray-App, Linux-Kommando `sovereignmind` mit Mock von `status`), Screenshots, Kontakt |
| `download.html` | Installation für Windows (Setup) und Linux (Ein-Befehl-Bundle) aus einem Google-Drive-Ordner, **Demo** (eine Software, Wahl beim ersten Start; ohne Lizenz, 24 Stunden, nur localhost; Abschnitt `#demo`), Prüfsummen der aktuellen Version, Update, Befehlsübersicht des Linux-Kommandos |
| `wissenspakete.html` | Katalog der Wissenspakete aus `packages/index.json` |
| `vergleich.html` | Sachlicher Vergleich lokal/Cloud, Kostenbeispiel und Rechner aus `assets/kosten.json` (Quellen und Prüfliste: im Hauptprojekt zu klären, `Support/docs/vergleich/` gibt es dort nicht mehr) |
| `api.html` | API-Dokumentation aus `assets/api/openapi.json`: Einleitung, Ablauf, Endpunkte mit Parametern, Antworten und Codebeispielen (curl, C#, Python, JavaScript), Datentypen; Renderer `assets/api-doku.js`, Stile `assets/api-doku.css` |
| `praesentation/` | Präsentation (18 Folien, mit „Ausprobieren“) |

## Lokal ansehen

```bash
python3 -m http.server 8080   # im Repo-Ordner, dann http://localhost:8080
```

## Tests

```bash
node --test "tests/*.test.mjs"   # im Repo-Ordner; Node 20+, keine Abhängigkeiten
```

`tests/api-doku.test.mjs` prüft den Renderer der API-Seite ohne Browser (Schein-DOM): Markdown-Teilsatz (kein HTML-Durchlass, nur `http(s)`-Links), `$ref`-Auflösung mit Zyklenschutz, Beispiel-Generator und Codebeispiele (curl, C#, Python, JavaScript) für alle Endpunkte der committeten `assets/api/openapi.json`. `tests/` und `scripts/` gelangen nicht auf die veröffentlichte Seite (`pages.yml`). Vor dem Push nach Änderungen an `api-doku.js` oder `openapi.json` ausführen; `assets/api-doku.js`/`.css` danach mit `sync-app-api-doku.py` in die App kopieren (Hauptprojekt).

## Impressum und Datenschutz (Anbieterdaten)

`index.html` (Kontakt), `impressum.html` und `datenschutz.html` enthalten nur Platzhalter (`{{PROVIDER_NAME}}`, `{{PROVIDER_STREET}}`, `{{PROVIDER_CITY}}`, `{{PROVIDER_EMAIL}}`, `{{PROVIDER_PHONE}}`, `{{PROVIDER_VAT_ID}}`). Die Anschrift steht nicht im Repo: `pages.yml` setzt sie mit `scripts/render-provider.py` aus den Actions-**Variablen** der Organisation (nicht Secrets) in eine Kopie ein und bricht ab, wenn ein Pflichtwert (Name, Straße, Ort, E-Mail) fehlt. Lokal zeigt die Seite die Platzhalter; für eine Vorschau mit Testwerten in einer Kopie: `python3 scripts/render-provider.py --test-values <kopie>/index.html <kopie>/impressum.html <kopie>/datenschutz.html`.

## Pflege

- **Vergleichsseite:** Preise und Annahmen nur in `assets/kosten.json` (Stand-Datum wird daraus angezeigt), quartalsweise gegen die Anbieterseiten prüfen; danach im Hauptprojekt `python3 Support/docs/vergleich/kostenmodell.py` und `node Support/docs/vergleich/test-vergleich.mjs` ausführen.

- **Version, Download-Ordner:** nur in `assets/downloads.json` (von Hand pflegen, sonst zeigt die Seite die alte Version; Prüfsummen werden derzeit bewusst nicht veröffentlicht):
  `version`, `driveFolderUrl` (Freigabe „Jeder mit dem Link“, nur ansehen; muss mit `https://` beginnen).
  Fehlt die Datei oder der Ordner-Link, blenden die Knöpfe sich aus und ein Hinweis steht da. Das ist der letzte Schritt des
  Release-Ablaufs (`Support/docs/installer-lokal-bauen.md` im Hauptprojekt). Dort liegen auch die Dateien: Windows-Setup (`.exe` plus `-N.bin`),
  Linux-Bundle (`sovereignmind-installer_<Version>_amd64.run.partNN`). Der Linux-Befehl steht in `assets/app.js`
  (`COMMANDS`, `<Version>` wird aus `downloads.json` eingesetzt); mit dem README des Installer-Repos abgleichen.
- **Demo:** Es gibt nur **eine** Software und einen Installer. Der Abschnitt `#demo` in `download.html` beschreibt, was beim ersten Start
  zur Wahl steht („Demo starten“ oder „Mit Lizenz einrichten“), die Grenzen (24 Stunden, ein Sitzplatz, nur localhost, Löschung, Neustart
  möglich, Freischaltung mit Schlüssel) und die öffentlichen Zugangsdaten. Mit dem Plan `docs/pläne/demo-willkommen` im Hauptprojekt
  abgleichen (Phase 6). Die Seite „Demo abgelaufen“ in der App verlinkt auf den Drive-Ordner (Repository-Variable `DEMO_DOWNLOAD_URL`).
- **Hinweis „Entwurf / derzeit nur Demo“:** steht gut sichtbar auf `index.html` und `download.html` (Klasse `note warn`, Attribut
  `data-status-note`) mit demselben Wortlaut wie der Absatz „STAND DER SOFTWARE“ in `Support/installer/EULA.de.txt` und der Willkommensseite
  der App. Ändert sich einer, alle drei anpassen.
- **Linux-Kommando:** Die Befehlstabelle steht in `download.html` (Abschnitt „Bedienung auf der Kommandozeile“), der Mock der
  Ausgabe von `sovereignmind status` in `index.html` (Abschnitt `#betrieb`, Klasse `term`). Der Mock ist Text, kein Bild, und
  zeigt Beispieldaten (Adresse `192.168.0.42`). Ändert sich die Ausgabe von `sovereignmind status` im Hauptprojekt
  (`Support/installer/linux/bin/sovereignmind`), den Mock anpassen.
- **Screenshots:** nach `assets/screenshots/` legen (nur Testdaten); die Liste der Bilder steht in `assets/app.js` (`SHOTS`).
- **Offen vor Veröffentlichung:** Kontaktweg (`index.html`, Abschnitt Kontakt), Impressum und Datenschutz (Platzhalter).
- **API-Seite:** `assets/api/openapi.json` nur über das Sync-Skript des Hauptprojekts ändern (`Support/scripts/sync-website-api.py`, prüft vor dem Kopieren auf interne Pfade und Zugangsdaten), nie von Hand. Die Seite zeigt Version aus `downloads.json` und das Datum der Datei. Basis-URL und Sprache der Codebeispiele merkt sich der Browser (`localStorage`). `pages.yml` kopiert `assets/api/` automatisch mit.
- Keine Inhalte aus dem privaten Hauptrepo ungeprüft übernehmen.

## Veröffentlichung

Ordnerinhalt als Wurzel eines öffentlichen Repos pushen; Settings → Pages → Quelle „GitHub Actions“
(Workflow `.github/workflows/pages.yml`).

## Pakete pflegen

Die Seite `wissenspakete.html` liest `packages/index.json`. Diese Datei kommt aus dem Admin-Tool
(Release-Bundle, `Support/scripts/publish-packages.ps1`) und wird **nicht von Hand geändert**.
Neue Version = neuer Eintrag, ältere Versionen erscheinen unter „Weitere Versionen“;
`withdrawn: true` blendet einen Eintrag aus. Alle Texte werden per `textContent` ausgegeben.
