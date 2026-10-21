#!/usr/bin/env python3
"""Setzt die Anbieterdaten in Textdateien ein (Phase 7.2, Abschnitt C).

Die Quellen im Repo tragen nur Platzhalter ({{PROVIDER_NAME}} usw.); die Anschrift steht nicht im Repo.
Der Build (GitHub Actions) setzt die Werte aus den Organisations-Variablen ein, in der Kopie auf dem Runner.

  render-provider.py [--test-values] DATEI...

Pflicht: PROVIDER_NAME, PROVIDER_STREET, PROVIDER_CITY, PROVIDER_EMAIL (nur die, die in der jeweiligen Datei vorkommen).
Optional: PROVIDER_PHONE, PROVIDER_VAT_ID (leer = "nicht angegeben"). PROVIDER_PRIVACY_URL ist Pflicht, wo {{PROVIDER_PRIVACY_URL}} steht.
Fehlt ein Pflichtwert oder bleibt ein {{...}} stehen, bricht das Skript ab, ohne etwas zu schreiben.
--test-values setzt erkennbare Testwerte (nur für die lokale Vorschau, nie für ein Release).
"""
import os
import re
import sys

REQUIRED = ["PROVIDER_NAME", "PROVIDER_STREET", "PROVIDER_CITY", "PROVIDER_EMAIL", "PROVIDER_PRIVACY_URL"]
OPTIONAL = ["PROVIDER_PHONE", "PROVIDER_VAT_ID"]
TEST = {
    "PROVIDER_NAME": "Test Anbieter GmbH",
    "PROVIDER_STREET": "Teststraße 1",
    "PROVIDER_CITY": "12345 Teststadt",
    "PROVIDER_EMAIL": "test@example.invalid",
    "PROVIDER_PRIVACY_URL": "https://example.invalid/datenschutz.html",
    "PROVIDER_PHONE": "+49 000 000000",
    "PROVIDER_VAT_ID": "DE000000000",
}
PLACEHOLDER = re.compile(r"\{\{([A-Z_]+)\}\}")


def main(argv):
    test = "--test-values" in argv
    files = [a for a in argv if not a.startswith("--")]
    if not files:
        print(__doc__, file=sys.stderr)
        return 2
    values = dict(TEST) if test else {k: os.environ.get(k, "").strip() for k in REQUIRED + OPTIONAL}
    problems, rendered = [], {}
    for path in files:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()

        def replace(match):
            name = match.group(1)
            if name not in REQUIRED + OPTIONAL:
                problems.append(f"{path}: unbekannter Platzhalter {{{{{name}}}}}")
                return match.group(0)
            if not values[name]:
                if name in OPTIONAL:
                    return "nicht angegeben"
                problems.append(f"{path}: {name} ist nicht gesetzt (Organisations-Variable fehlt)")
                return match.group(0)
            return values[name]

        rendered[path] = PLACEHOLDER.sub(replace, text)
    if problems:
        print("render-provider: abgebrochen\n  " + "\n  ".join(sorted(set(problems))), file=sys.stderr)
        return 1
    for path, text in rendered.items():
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        print(f"render-provider: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
