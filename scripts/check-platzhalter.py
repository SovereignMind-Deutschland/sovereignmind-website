#!/usr/bin/env python3
"""Sucht in Ordnern und Dateien nach übrig gebliebenen Anbieter-Platzhaltern und bricht dann mit Exit-Code 1 ab.

Gegenstück zu render-provider.py: Das Skript setzt die Werte ein, dieses hier beweist, dass nichts stehen geblieben ist.
Läuft in den Pipelines nach dem Einsetzen (Website: pages.yml, Installer: publish-installers.yml) und in den Tests.

  check-platzhalter.py [--any] PFAD...

Standard: nur {{PROVIDER_...}}. Mit --any zählt schon jedes "{{" (für die Website, wo sonst keine Doppelklammern vorkommen).
Gelesen werden nur Textdateien bekannter Endungen; Modelle, Bilder, Archive und ähnliches werden übersprungen.
Exit-Codes: 0 sauber, 1 Rest gefunden, 2 Aufruf falsch oder Pfad fehlt.
"""
import os
import re
import sys

TEXT_SUFFIXES = {
    ".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".md", ".xml", ".svg", ".yml", ".yaml", ".sh",
    ".ps1", ".py", ".ts", ".tsx", ".cfg", ".conf", ".ini", ".service", ".iss", ".rtf", ".webmanifest",
    ".map", ".tmpl", ".template", ".in", "",
}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "wheelhouse", "models", "site-packages"}
MAX_BYTES = 8 * 1024 * 1024  # größere Dateien sind keine Seitentexte
PROVIDER = re.compile(r"\{\{\s*PROVIDER_[A-Z_]+\s*\}\}")
ANY = re.compile(r"\{\{")


def iter_files(path):
    if os.path.isfile(path):
        yield path
        return
    for root, dirs, names in os.walk(path):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(names):
            yield os.path.join(root, name)


def scan(paths, pattern):
    """Gibt [(Datei, Zeilennummer, Zeile)] zurück."""
    hits = []
    for base in paths:
        for file in iter_files(base):
            suffix = os.path.splitext(file)[1].lower()
            if suffix not in TEXT_SUFFIXES:
                continue
            try:
                if os.path.getsize(file) > MAX_BYTES:
                    continue
                with open(file, encoding="utf-8", errors="replace") as handle:
                    for number, line in enumerate(handle, 1):
                        if pattern.search(line):
                            hits.append((file, number, line.strip()[:160]))
            except OSError as error:
                print(f"check-platzhalter: {file} nicht lesbar: {error}", file=sys.stderr)
                hits.append((file, 0, "nicht lesbar"))
    return hits


def main(argv):
    any_brace = "--any" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if not paths:
        print(__doc__, file=sys.stderr)
        return 2
    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        print("check-platzhalter: Pfad fehlt: " + ", ".join(missing), file=sys.stderr)
        return 2
    hits = scan(paths, ANY if any_brace else PROVIDER)
    if hits:
        print(f"check-platzhalter: {len(hits)} Platzhalter-Rest(e) gefunden", file=sys.stderr)
        for file, number, line in hits[:50]:
            print(f"  {file}:{number}: {line}", file=sys.stderr)
        return 1
    print("check-platzhalter: sauber")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
