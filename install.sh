#!/bin/sh
# SovereignMind: Installation der minimalen Variante unter Linux per Einzeiler.
#   curl -fsSL https://sovereignmind-deutschland.github.io/sovereignmind-website/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --dry-run
# Ohne root fragt das Skript das sudo-Passwort gleich zu Beginn ab (vor dem Download) und hält es bis zum Ende gültig.
# Lädt die Teile des Bundles aus dem GitHub-Release, prüft sie, fügt sie zusammen und startet das Bundle.
#
# Umgebungsvariablen:
#   SM_VERSION       Version (Tag ohne "v"); Standard: neuestes Release
#   SM_VARIANT       minimal (einzige Variante dieses Skripts)
#   SM_DOWNLOAD_DIR  Ordner, in dem das Skript seinen eigenen Arbeitsordner sovereignmind-download.XXXXXX (Modus 0700) anlegt
#                    (Standard /var/tmp, nicht /tmp: oft RAM-Disk). Ein vorhandener Ordner bleibt stehen; gelöscht wird nur der eigene.
#   SM_KEEP=1        Arbeitsordner nicht löschen
#   SM_BUNDLE_ARGS   Optionen für das Bundle, z. B. "--port 8443 --no-frontend"
#   SM_REQUIRE_SIGNATURE  leer (Standard): Signatur von SHA256SUMS.txt prüfen, wenn minisign installiert ist, sonst Warnung und nur
#                    Prüfsummen; 1: Signaturprüfung erzwingen (ohne minisign Abbruch); 0: ein Release ohne Signatur zulassen (ältere Versionen).
#                    Eine ungültige Signatur bricht immer ab.
#   SM_SKIP_HW_CHECK=1  Hardware-Hinweis (empfohlen: 16 GB RAM, 8 GB Grafikspeicher) überspringen; der Hinweis bricht nie ab
#   SM_API_URL, SM_BASE_URL, SM_OS_RELEASE, SM_SUDO, SM_FREE_KB, SM_RAM_KB, SM_VRAM_MB, SM_MINISIGN_PUBKEY   (nur für Tests)
# Argumente: --dry-run (nur prüfen und anzeigen); alles andere geht an das Bundle.
# Exit-Codes: 0 Erfolg, 1 Fehler.

set -eu

REPO="sovereignmind-deutschland/sovereignmind-installer"
SM_API_URL="${SM_API_URL:-https://api.github.com/repos/$REPO/releases/latest}"
SM_VARIANT="${SM_VARIANT:-minimal}"
SM_DOWNLOAD_DIR="${SM_DOWNLOAD_DIR:-/var/tmp}"
# Öffentlicher minisign-Schlüssel für SHA256SUMS.txt; derselbe steht in install.ps1, in minisign.pub und auf der Download-Seite
# (Abschnitt Prüfsummen). Solange hier der Platzhalter steht, wird die Signatur nicht geprüft.
MINISIGN_PUBKEY="${SM_MINISIGN_PUBKEY:-PLATZHALTER_MINISIGN_PUBKEY}"
# Empfohlene Hardware (Website, Download-Seite): 16 GB RAM, 8 GB Grafikspeicher. Etwas Spielraum, weil MemTotal unter dem eingebauten Wert liegt.
REC_RAM_KB=$((15 * 1024 * 1024))
REC_VRAM_MB=$((7 * 1024))
# Platzbedarf im Arbeitsordner in KiB: Download ca. 0,9 GB + Entpacken ca. 0,9 GB durch das Bundle, großzügiger Puffer
NEED_KB=$((6 * 1024 * 1024))

status() { printf '>>> %s\n' "$*" >&2; }
error() { printf 'FEHLER: %s\n' "$*" >&2; exit 1; }
warning() { printf 'WARNUNG: %s\n' "$*" >&2; }

# Hinweis, kein Abbruch: SovereignMind läuft auch mit weniger, aber Antworten und Dokumentenverarbeitung werden dann langsam oder scheitern.
hardware_check() {
  [ "${SM_SKIP_HW_CHECK:-0}" = "1" ] && return 0
  ram_kb="${SM_RAM_KB:-$(sed -n 's/^MemTotal:[[:space:]]*\([0-9]*\) kB.*/\1/p' /proc/meminfo 2>/dev/null | head -n 1)}"
  case "$ram_kb" in ''|*[!0-9]*) ram_kb="" ;; esac
  vram_mb="${SM_VRAM_MB:-}"
  if [ -z "$vram_mb" ] && available nvidia-smi; then
    vram_mb="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | sort -n | tail -n 1 | tr -d '[:space:]')"
  fi
  case "$vram_mb" in ''|*[!0-9]*) vram_mb="" ;; esac
  if [ -n "$ram_kb" ] && [ "$ram_kb" -lt "$REC_RAM_KB" ]; then
    warning "Arbeitsspeicher: $((ram_kb / 1024 / 1024)) GB erkannt, empfohlen sind 16 GB. Die Installation läuft weiter; mit weniger Speicher können große Dokumente und lange Antworten scheitern."
  fi
  if [ -z "$vram_mb" ]; then
    status "Grafikspeicher nicht ermittelt (keine NVIDIA-Karte mit nvidia-smi gefunden). Empfohlen sind 8 GB; ohne passende Grafikkarte antwortet die KI deutlich langsamer."
  elif [ "$vram_mb" -lt "$REC_VRAM_MB" ]; then
    warning "Grafikspeicher: $((vram_mb / 1024)) GB erkannt, empfohlen sind 8 GB. Die Installation läuft weiter; die KI antwortet dann langsamer oder nutzt den Prozessor."
  fi
}
available() { command -v "$1" >/dev/null 2>&1; }

WORK=""
ROOT_WORK=""
PARENT_CREATED=0
RESUMABLE=0
SUDO_KEEP=""
# Löscht nur, was dieses Skript selbst angelegt hat: den eigenen Arbeitsordner, die root-Kopie des Bundles und einen
# SM_DOWNLOAD_DIR, den es neu angelegt hat, und auch den nur, wenn er danach leer ist (rmdir). Bricht der Download der Teile ab
# (Netz, Strg+C), bleibt der Arbeitsordner für die Wiederaufnahme stehen (RESUMABLE=1); bei Erfolg und bei jedem Prüffehler wird er gelöscht.
cleanup() {
  if [ -n "$ROOT_WORK" ]; then $SUDO rm -rf -- "$ROOT_WORK" 2>/dev/null || true; fi
  if [ -n "$SUDO_KEEP" ]; then kill "$SUDO_KEEP" 2>/dev/null || true; fi
  [ -n "$WORK" ] || return 0
  if [ "${SM_KEEP:-0}" = "1" ]; then status "Arbeitsordner bleibt erhalten: $WORK"; return 0; fi
  if [ "$RESUMABLE" = 1 ]; then status "Der Download ist unvollständig. Beim nächsten Start geht es in $WORK weiter."; return 0; fi
  rm -rf -- "$WORK"
  if [ "$PARENT_CREATED" = 1 ]; then rmdir -- "$SM_DOWNLOAD_DIR" 2>/dev/null || true; fi
}

fetch() { # URL ZIEL (mit Wiederaufnahme)
  curl --fail --show-error --location --progress-bar -C - -o "$2" "$1"
}

sudo_prepare() { # sudo-Passwort vor dem Download abfragen und bis zum Ende gültig halten
  [ "$SUDO" = "sudo" ] || return 0
  if [ "$TTY" = 0 ]; then
    sudo -n -v 2>/dev/null || error "sudo braucht ein Passwort, es gibt aber kein Terminal. Als root starten: curl -fsSL .../install.sh | sudo sh -s -- --accept-eula --yes"
  else
    status "Die Installation braucht root-Rechte. Bitte jetzt das sudo-Passwort eingeben; danach läuft alles ohne weitere Rückfrage."
    sudo -v || error "sudo-Anmeldung fehlgeschlagen."
  fi
  # Download dauert oft länger als die sudo-Frist (Standard 15 min): Anmeldung im Hintergrund auffrischen
  ( while kill -0 $$ 2>/dev/null; do sleep 50; sudo -n -v 2>/dev/null || exit 0; done ) >/dev/null 2>&1 &
  SUDO_KEEP=$!
}

sum_of() { # SUMS NAME -> erwartete Summe (Dateiname exakt verglichen, kein regulärer Ausdruck)
  awk -v n="$2" '{ f = $2; sub(/^\*/, "", f) } NF == 2 && f == n && $1 ~ /^[0-9a-fA-F]+$/ && length($1) == 64 { print tolower($1); exit }' "$1"
}

sum_ok() { # SUMS NAME DATEI -> 0, wenn die Summe passt
  want="$(sum_of "$1" "$2")"
  [ -n "$want" ] || return 1
  got="$(sha256sum "$3" | cut -d' ' -f1)"
  [ "$want" = "$got" ]
}

# ls -ldn liefert Rechte und Besitzer als Zahl vor dem Namen; stat -c ist nicht POSIX. Der Name selbst wird nicht ausgewertet.
# shellcheck disable=SC2012
perm_of() { ls -ldn -- "$1" | cut -c1-10; }
# shellcheck disable=SC2012
uid_of() { ls -ldn -- "$1" | awk '{ print $3 }'; }

# Ordner, in dem außer root und diesem Benutzer niemand Einträge umbenennen oder ersetzen kann: Besitzer root oder dieser
# Benutzer, kein Symlink, und für andere nur beschreibbar mit Sticky-Bit (wie /var/tmp).
parent_ok() { # ORDNER
  [ -d "$1" ] && [ ! -L "$1" ] || return 1
  case "$(uid_of "$1")" in 0|"$(id -u)") ;; *) return 1 ;; esac
  p="$(perm_of "$1")"
  case "$p" in ?????w????|????????w?) case "$p" in *t|*T) return 0 ;; *) return 1 ;; esac ;; esac
  return 0
}

# Eigener Arbeitsordner: gehört diesem Benutzer, Modus 0700, kein Symlink (auch ein vorhandener Ordner einer früheren Sitzung).
workdir_ok() { # ORDNER
  [ -d "$1" ] && [ ! -L "$1" ] && [ "$(uid_of "$1")" = "$(id -u)" ] && [ "$(perm_of "$1")" = "drwx------" ]
}

# Signatur von SHA256SUMS.txt (minisign, Entscheidung E4). Die Prüfsummen der Teile sind nur so viel wert wie diese Datei:
# Wer das Release übernimmt, tauscht sonst Summen und Pakete gemeinsam aus.
verify_signature() { # SUMS
  req="${SM_REQUIRE_SIGNATURE:-}"
  case "$MINISIGN_PUBKEY" in
    PLATZHALTER*)
      [ "$req" != 1 ] || error "SM_REQUIRE_SIGNATURE=1, aber dieses Skript enthält noch keinen öffentlichen minisign-Schlüssel."
      warning "Signaturprüfung übersprungen: dieses Skript enthält noch keinen öffentlichen minisign-Schlüssel. Geprüft werden nur die SHA-256-Prüfsummen."
      return 0 ;;
  esac
  if ! available minisign; then
    [ "$req" != 1 ] || error "minisign fehlt (SM_REQUIRE_SIGNATURE=1). Installieren: sudo apt install minisign (bzw. sudo dnf install minisign)."
    warning "minisign ist nicht installiert: die Signatur von SHA256SUMS.txt wird nicht geprüft, nur die SHA-256-Prüfsummen. Empfohlen: 'sudo apt install minisign' (bzw. dnf) und erneut starten; SM_REQUIRE_SIGNATURE=1 erzwingt die Prüfung."
    return 0
  fi
  rm -f "$1.minisig"
  if ! curl --fail --silent --show-error --location -o "$1.minisig" "$BASE/SHA256SUMS.txt.minisig" 2>/dev/null; then
    rm -f "$1.minisig"
    if [ "$req" = 0 ]; then warning "Das Release $TAG hat keine Signatur (SHA256SUMS.txt.minisig); SM_REQUIRE_SIGNATURE=0: nur Prüfsummen."; return 0; fi
    error "Das Release $TAG hat keine Signatur (SHA256SUMS.txt.minisig). Ältere Versionen ohne Signatur nur mit SM_REQUIRE_SIGNATURE=0."
  fi
  minisign -V -q -P "$MINISIGN_PUBKEY" -m "$1" -x "$1.minisig" >/dev/null 2>&1 ||
    error "Die Signatur von SHA256SUMS.txt ist ungültig. Nichts wurde installiert. Bitte nicht erneut versuchen, sondern den Anbieter informieren (Download-Seite, Abschnitt Prüfsummen)."
  status "Signatur von SHA256SUMS.txt geprüft (minisign)."
}

main() {
  DRY=0
  ARGS=""
  for a in "$@"; do
    if [ "$a" = "--dry-run" ]; then DRY=1; else ARGS="$ARGS $a"; fi
  done
  ARGS="$ARGS ${SM_BUNDLE_ARGS:-}"

  [ "$SM_VARIANT" = "minimal" ] || error "SM_VARIANT=$SM_VARIANT wird nicht unterstützt (nur minimal)."
  [ "$(uname -s)" = "Linux" ] || error "Dieses Skript läuft nur unter Linux."
  [ "$(uname -m)" = "x86_64" ] || error "Nur x86_64 wird unterstützt (gefunden: $(uname -m))."

  # Distribution: Debian-Familie -> _amd64, RPM-Familie -> _x86_64
  OSR="${SM_OS_RELEASE:-/etc/os-release}"
  [ -r "$OSR" ] || error "$OSR fehlt, die Distribution ist nicht erkennbar."
  # shellcheck disable=SC1090
  distro="$(. "$OSR"; printf '%s %s' "${ID:-}" "${ID_LIKE:-}")"
  case " $distro " in
    *" debian "*|*" ubuntu "*) ARCH="amd64" ;;
    *" rhel "*|*" fedora "*|*" centos "*|*" suse "*|*" rocky "*|*" almalinux "*) ARCH="x86_64" ;;
    *) error "Distribution '$distro' wird nicht unterstützt (Debian/Ubuntu oder RPM-Familie)." ;;
  esac

  for t in curl sha256sum cat grep sed head df rm mkdir mktemp awk ls cut; do
    available "$t" || error "'$t' wird benötigt und fehlt."
  done

  SUDO=""
  if [ "${SM_SUDO+x}" = "x" ]; then
    SUDO="$SM_SUDO"
  elif [ "$(id -u)" -ne 0 ]; then
    available sudo || error "Das Bundle braucht root. Als root starten oder 'sudo' installieren."
    SUDO="sudo"
  fi

  # Version
  if [ -n "${SM_VERSION:-}" ]; then
    VERSION="${SM_VERSION#v}"
  else
    status "Ermittle die neueste Version ..."
    json="$(curl --fail --silent --show-error --location "$SM_API_URL" 2>&1)" || {
      case "$json" in
        *403*|*429*) error "GitHub-API-Limit erreicht. Version angeben, z. B.: SM_VERSION=2026.11.16.1917 (siehe Download-Seite)." ;;
        *) error "Release nicht abrufbar: $json" ;;
      esac
    }
    tag="$(printf '%s' "$json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    [ -n "$tag" ] || error "Kein 'tag_name' in der Antwort der Release-API."
    VERSION="${tag#v}"
  fi
  case "$VERSION" in ''|*[!0-9A-Za-z._-]*) error "Ungültige Version '$VERSION'." ;; esac
  TAG="v$VERSION"
  BASE="${SM_BASE_URL:-https://github.com/$REPO/releases/download}/$TAG"
  status "Version $VERSION ($ARCH, $SM_VARIANT)"

  # Platz (der Ordner wird erst nach dem Trockenlauf angelegt)
  probe="$SM_DOWNLOAD_DIR"
  while [ ! -d "$probe" ]; do probe="$(dirname "$probe")"; done
  free_kb="${SM_FREE_KB:-$(df -Pk "$probe" | sed -n '2p' | tr -s ' ' | cut -d' ' -f4)}"
  if [ "$free_kb" -lt "$NEED_KB" ]; then
    error "Zu wenig Platz in $probe: frei $((free_kb / 1024)) MiB, nötig ca. $((NEED_KB / 1024)) MiB. Anderen Ordner mit SM_DOWNLOAD_DIR wählen."
  fi
  hardware_check
  warning "Danach lädt die Installation ca. 11 GB Modelle nach /var/lib; dort ebenfalls genug Platz einplanen."

  if [ "$DRY" = 1 ]; then
    status "Trockenlauf: würde $BASE/SHA256SUMS.txt und die Teile *_${ARCH}.run.partNN in einen neuen Ordner unter $SM_DOWNLOAD_DIR laden und '${SUDO:+$SUDO }bash bundle.run$ARGS' starten. Nichts wurde geändert."
    return 0
  fi

  # EULA-Frage braucht ein Terminal: bei 'curl | sh' von /dev/tty lesen
  TTY=0
  if [ -t 0 ]; then TTY=1; elif ( : </dev/tty ) 2>/dev/null; then TTY=2; fi
  if [ "$TTY" = 0 ]; then
    case " $ARGS " in
      *" --accept-eula "*) ;;
      *) error "Kein Terminal für die Lizenzfrage. Mit '--accept-eula --yes' (siehe SM_BUNDLE_ARGS) oder in einem Terminal starten." ;;
    esac
    case " $ARGS " in
      *" --yes "*|*" -y "*) ;;
      *) error "Kein Terminal für Rückfragen. Zusätzlich '--yes' angeben." ;;
    esac
  fi

  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  sudo_prepare

  # Eigener Arbeitsordner (Fund 1 und 2 des Installer-Reviews): nie einen vorhandenen, womöglich fremden Ordner übernehmen.
  if [ ! -e "$SM_DOWNLOAD_DIR" ]; then
    ( umask 022; mkdir -p "$SM_DOWNLOAD_DIR" ) 2>/dev/null || error "Ordner $SM_DOWNLOAD_DIR nicht anlegbar (SM_DOWNLOAD_DIR setzen)."
    PARENT_CREATED=1
  fi
  parent_ok "$SM_DOWNLOAD_DIR" || error "$SM_DOWNLOAD_DIR ist kein sicherer Ort (Symlink, fremder Besitzer oder für andere beschreibbar ohne Sticky-Bit). Anderen Ordner mit SM_DOWNLOAD_DIR wählen."
  # Fester Name (Benutzer, Version, Architektur), damit ein abgebrochener Download weiterläuft. mkdir ohne -p legt nur neu an; ein
  # vorhandener Ordner wird nur übernommen, wenn er diesem Benutzer gehört, Modus 0700 hat und kein Symlink ist (sonst Abbruch).
  WORK="$SM_DOWNLOAD_DIR/sovereignmind-download-$(id -u)-${VERSION}-${ARCH}"
  if [ ! -e "$WORK" ] && [ ! -L "$WORK" ]; then
    ( umask 077; mkdir -- "$WORK" ) 2>/dev/null || { WORK=""; error "Arbeitsordner in $SM_DOWNLOAD_DIR nicht anlegbar (SM_DOWNLOAD_DIR setzen)."; }
  fi
  workdir_ok "$WORK" || { w="$WORK"; WORK=""; error "Arbeitsordner $w gehört nicht diesem Benutzer, hat nicht Modus 0700 oder ist ein Symlink. Nichts wurde geändert; Ordner prüfen und entfernen."; }
  status "Arbeitsordner: $WORK"

  status "Lade Prüfsummen ..."
  fetch "$BASE/SHA256SUMS.txt" "$WORK/SHA256SUMS.txt" || error "SHA256SUMS.txt nicht ladbar ($BASE). Existiert die Version $VERSION?"
  verify_signature "$WORK/SHA256SUMS.txt"

  VRE="$(printf '%s' "$VERSION" | sed 's/\./\\./g')"   # Punkte der Version wörtlich
  PARTS="$(sed -n "s/^[0-9a-fA-F]\{64\}[ ][ *]\(sovereignmind-installer-minimal_${VRE}_${ARCH}\.run\.part[0-9]\{1,\}\)\$/\1/p" "$WORK/SHA256SUMS.txt" | sort)"
  [ -n "$PARTS" ] || error "Im Release $TAG gibt es keine Teile für $ARCH."
  TOTAL="$(printf '%s\n' "$PARTS" | wc -l | tr -d ' ')"

  BUNDLE="$WORK/bundle.run"
  RUN_NAME="sovereignmind-installer-minimal_${VERSION}_${ARCH}.run"
  # Wiederaufnahme: `merged` merkt sich (Zahl der angehängten Teile, Größe des Bundles). Passt die Größe nicht, fängt der Lauf neu an.
  MERGED=0
  if [ -f "$WORK/merged" ] && [ -f "$BUNDLE" ] && [ ! -L "$BUNDLE" ] && read -r MERGED MSIZE < "$WORK/merged" 2>/dev/null &&
     [ "$(wc -c < "$BUNDLE" | tr -d ' ')" = "$MSIZE" ]; then
    status "Früherer Download gefunden: $MERGED Teil(e) bereits geprüft."
  else
    MERGED=0; : > "$BUNDLE"; rm -f "$WORK/merged"
  fi
  RESUMABLE=1
  i=0
  for p in $PARTS; do
    i=$((i + 1))
    if [ "$i" -le "$MERGED" ]; then status "Teil $i von $TOTAL: $p (schon vorhanden)"; continue; fi
    status "Teil $i von $TOTAL: $p"
    [ ! -L "$WORK/$p" ] || { rm -f "$WORK/$p"; }
    # Ein vollständiger Rest einer früheren Sitzung wird nicht erneut geladen; ein unvollständiger setzt curl fort (-C -).
    if [ ! -f "$WORK/$p" ] || ! sum_ok "$WORK/SHA256SUMS.txt" "$p" "$WORK/$p"; then
      had=0; [ -f "$WORK/$p" ] && had=1
      fetch "$BASE/$p" "$WORK/$p" || error "Download von $p fehlgeschlagen. Bitte erneut starten, er wird fortgesetzt."
      if [ "$had" = 1 ] && ! sum_ok "$WORK/SHA256SUMS.txt" "$p" "$WORK/$p"; then
        # Der fortgesetzte Rest passte nicht (anderer Stand auf dem Server?): einmal komplett neu laden.
        rm -f "$WORK/$p"
        fetch "$BASE/$p" "$WORK/$p" || error "Download von $p fehlgeschlagen. Bitte erneut starten, er wird fortgesetzt."
      fi
    fi
    sum_ok "$WORK/SHA256SUMS.txt" "$p" "$WORK/$p" || { RESUMABLE=0; rm -f "$WORK/$p" "$BUNDLE" "$WORK/merged"; error "Prüfsumme von $p stimmt nicht. Teil gelöscht; bitte erneut starten."; }
    # Anhängen, Stand merken, Teil löschen: spart Platz
    cat "$WORK/$p" >> "$BUNDLE"
    printf '%s %s\n' "$i" "$(wc -c < "$BUNDLE" | tr -d ' ')" > "$WORK/merged"
    rm -f "$WORK/$p"
  done
  RESUMABLE=0
  status "Alle $TOTAL Teile geprüft und zusammengefügt."
  BUNDLE_SUM="$(sha256sum "$BUNDLE" | cut -d' ' -f1)"
  want="$(sum_of "$WORK/SHA256SUMS.txt" "$RUN_NAME")"
  if [ -n "$want" ]; then
    [ "$want" = "$BUNDLE_SUM" ] || error "Prüfsumme des zusammengefügten Bundles stimmt nicht ($RUN_NAME). Bitte erneut starten."
    status "Prüfsumme des zusammengefügten Bundles stimmt."
  fi

  # Ausgeführt wird nur eine Datei, die außer root niemand mehr ändern kann, und sie wird dort unmittelbar vorher noch einmal geprüft.
  RUN_FILE="$BUNDLE"
  if [ -n "$SUDO" ]; then
    rparent="$SM_DOWNLOAD_DIR"
    [ "$(uid_of "$rparent")" = 0 ] && parent_ok "$rparent" || rparent=/var/tmp
    ROOT_WORK="$($SUDO mktemp -d "$rparent/sovereignmind-bundle.XXXXXX")" || { ROOT_WORK=""; error "Ordner für das Bundle in $rparent nicht anlegbar."; }
    $SUDO install -m 0600 "$BUNDLE" "$ROOT_WORK/bundle.run" || error "Bundle ließ sich nicht nach $ROOT_WORK kopieren."
    [ "${SM_KEEP:-0}" = "1" ] || rm -f "$BUNDLE"
    RUN_FILE="$ROOT_WORK/bundle.run"
    got="$($SUDO sha256sum "$RUN_FILE" | cut -d' ' -f1)"
  else
    workdir_ok "$WORK" || error "Arbeitsordner $WORK wurde verändert (Besitzer oder Rechte)."
    got="$(sha256sum "$RUN_FILE" | cut -d' ' -f1)"
  fi
  [ "$got" = "$BUNDLE_SUM" ] || error "Das Bundle wurde nach der Prüfung verändert. Nichts wurde installiert."

  status "Starte die Installation (${SUDO:-root}) ..."
  rc=0
  # shellcheck disable=SC2086
  case "$TTY" in
    1) $SUDO bash "$RUN_FILE" $ARGS || rc=$? ;;
    2) $SUDO bash "$RUN_FILE" $ARGS </dev/tty || rc=$? ;;
    *) $SUDO bash "$RUN_FILE" $ARGS </dev/null || rc=$? ;;
  esac
  [ "$rc" = 0 ] || error "Das Bundle endete mit Exit-Code $rc."

  status "Fertig. Status und Adresse: sovereignmind status"
}

main "$@"
