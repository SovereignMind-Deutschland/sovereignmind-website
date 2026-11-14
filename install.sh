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
#   SM_DOWNLOAD_DIR  Arbeitsordner (Standard /var/tmp/sovereignmind-install, nicht /tmp: oft RAM-Disk)
#   SM_KEEP=1        Arbeitsordner nicht löschen
#   SM_BUNDLE_ARGS   Optionen für das Bundle, z. B. "--port 8443 --no-frontend"
#   SM_API_URL, SM_BASE_URL, SM_OS_RELEASE, SM_SUDO, SM_FREE_KB   (nur für Tests)
# Argumente: --dry-run (nur prüfen und anzeigen); alles andere geht an das Bundle.
# Exit-Codes: 0 Erfolg, 1 Fehler.

set -eu

REPO="sovereignmind-deutschland/sovereignmind-installer"
SM_API_URL="${SM_API_URL:-https://api.github.com/repos/$REPO/releases/latest}"
SM_VARIANT="${SM_VARIANT:-minimal}"
SM_DOWNLOAD_DIR="${SM_DOWNLOAD_DIR:-/var/tmp/sovereignmind-install}"
# Platzbedarf im Arbeitsordner in KiB: Download ca. 0,9 GB + Entpacken ca. 0,9 GB durch das Bundle, großzügiger Puffer
NEED_KB=$((6 * 1024 * 1024))

status() { printf '>>> %s\n' "$*" >&2; }
error() { printf 'FEHLER: %s\n' "$*" >&2; exit 1; }
warning() { printf 'WARNUNG: %s\n' "$*" >&2; }
available() { command -v "$1" >/dev/null 2>&1; }

WORK=""
SUDO_KEEP=""
cleanup() {
  if [ -n "$SUDO_KEEP" ]; then kill "$SUDO_KEEP" 2>/dev/null || true; fi
  [ -n "$WORK" ] || return 0
  if [ "${SM_KEEP:-0}" = "1" ]; then status "Arbeitsordner bleibt erhalten: $WORK"; return 0; fi
  rm -rf "$WORK"
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

sum_ok() { # SUMS NAME DATEI -> 0, wenn die Summe passt
  line="$(grep "[ ][ *]$2\$" "$1" | head -n 1)" || return 1
  [ -n "$line" ] || return 1
  want="${line%% *}"
  got="$(sha256sum "$3" | cut -d' ' -f1)"
  [ "$want" = "$got" ]
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

  for t in curl sha256sum cat grep sed head df rm mkdir; do
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
        *403*|*429*) error "GitHub-API-Limit erreicht. Version angeben, z. B.: SM_VERSION=2026.11.12.1500 (siehe Download-Seite)." ;;
        *) error "Release nicht abrufbar: $json" ;;
      esac
    }
    tag="$(printf '%s' "$json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    [ -n "$tag" ] || error "Kein 'tag_name' in der Antwort der Release-API."
    VERSION="${tag#v}"
  fi
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
  warning "Danach lädt die Installation ca. 11 GB Modelle nach /var/lib; dort ebenfalls genug Platz einplanen."

  if [ "$DRY" = 1 ]; then
    status "Trockenlauf: würde $BASE/SHA256SUMS.txt und die Teile *_${ARCH}.run.partNN nach $SM_DOWNLOAD_DIR laden und '${SUDO:+$SUDO }bash bundle.run$ARGS' starten. Nichts wurde geändert."
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

  mkdir -p "$SM_DOWNLOAD_DIR" 2>/dev/null || error "Arbeitsordner $SM_DOWNLOAD_DIR nicht anlegbar (SM_DOWNLOAD_DIR setzen)."
  WORK="$SM_DOWNLOAD_DIR"

  status "Lade Prüfsummen ..."
  rm -f "$WORK/SHA256SUMS.txt"
  fetch "$BASE/SHA256SUMS.txt" "$WORK/SHA256SUMS.txt" || error "SHA256SUMS.txt nicht ladbar ($BASE). Existiert die Version $VERSION?"

  PARTS="$(sed -n "s/^[0-9a-fA-F]\{64\}[ ][ *]\(sovereignmind-installer-minimal_${VERSION}_${ARCH}\.run\.part[0-9]\{1,\}\)\$/\1/p" "$WORK/SHA256SUMS.txt" | sort)"
  [ -n "$PARTS" ] || error "Im Release $TAG gibt es keine Teile für $ARCH."
  TOTAL="$(printf '%s\n' "$PARTS" | wc -l | tr -d ' ')"

  BUNDLE="$WORK/bundle.run"
  : > "$BUNDLE"
  i=0
  for p in $PARTS; do
    i=$((i + 1))
    status "Teil $i von $TOTAL: $p"
    if [ -f "$WORK/$p" ] && sum_ok "$WORK/SHA256SUMS.txt" "$p" "$WORK/$p"; then
      status "bereits vollständig geladen"
    else
      fetch "$BASE/$p" "$WORK/$p" || error "Download von $p fehlgeschlagen. Erneut starten setzt den Download fort."
      sum_ok "$WORK/SHA256SUMS.txt" "$p" "$WORK/$p" || { rm -f "$WORK/$p" "$BUNDLE"; error "Prüfsumme von $p stimmt nicht. Teil gelöscht; bitte erneut starten."; }
    fi
    # Anhängen und Teil sofort löschen: spart Platz
    cat "$WORK/$p" >> "$BUNDLE"
    rm -f "$WORK/$p"
  done
  status "Alle $TOTAL Teile geprüft und zusammengefügt."

  status "Starte die Installation (${SUDO:-root}) ..."
  rc=0
  # shellcheck disable=SC2086
  case "$TTY" in
    1) $SUDO bash "$BUNDLE" $ARGS || rc=$? ;;
    2) $SUDO bash "$BUNDLE" $ARGS </dev/tty || rc=$? ;;
    *) $SUDO bash "$BUNDLE" $ARGS </dev/null || rc=$? ;;
  esac
  [ "$rc" = 0 ] || error "Das Bundle endete mit Exit-Code $rc."

  status "Fertig. Status und Adresse: sovereignmind status"
}

main "$@"
