# SovereignMind: Installation unter Windows per PowerShell-Skript (ersetzt das fruehere Inno-Setup SovereignMind-Setup-*.exe).
#   irm https://sovereignmind-deutschland.github.io/sovereignmind-website/install.ps1 | iex
# Vorab lesen: irm https://sovereignmind-deutschland.github.io/sovereignmind-website/install.ps1   (ohne "| iex")
# Mit Optionen (wie bei Linux install.sh --port ...):
#   & ([scriptblock]::Create((irm https://sovereignmind-deutschland.github.io/sovereignmind-website/install.ps1))) -Port 8443 -AcceptEula
#   .\install.ps1 -Port 8443 -Frontend off -AcceptEula           (Datei, z. B. Offline-Ordner mit den Teilen daneben)
#
# Ablauf: Version bestimmen, Pruefsummen laden, EULA zeigen (Zustimmung), Teile laden oder im Ordner neben dem Skript finden und pruefen
# (SHA-256), Ports pruefen, bei einem Update Sicherung und Dienste stoppen, Archiv nach %ProgramFiles%\SovereignMind entpacken,
# tools\install-native.ps1 aufrufen (Konfiguration, Postgres, Python, Dienste, Firewall), Eintrag unter "Apps & Features", Startmenue,
# danach Erstregistrierung, KI-Modelle (Variante minimal) und Recovery-Kit. Deinstallation: tools\uninstall.ps1.
#
# Optionen (die Schreibweise /PORT=8443 des frueheren Setups gilt weiter, auch in SM_SETUP_ARGS, z. B. "/PORT=8443 /FRONTEND=off"):
#   -Version <V>  -Variant minimal|full  -SourceDir <Ordner mit den Teilen>  -InstallDir <Ordner>  -DataDir <Ordner>
#   -Port <n>[,<n>..]  -PortAuto  -Lan  -LanAddress <ip>  -LanBackend|-LanChat|-LanAdmin on|off
#   -PublicHost <name>  -AdminHost <name>|none  -TlsMode internal|acme-http|acme-dns|wildcard|off  -DnsProvider <anbieter>  -Cors <liste>
#   -Frontend on|off  -HwAgent 0|1  -PawnIO 0|1  -Llm 0|1  -Models skip|load  -Config <config.jsonl>  -SkipPython
#   -PgPort -QdrantPort -QdrantGrpcPort -IngestionPort -VoicePort <n>
#   -LicenseEmail <mail> -LicenseToken <token> -AdminPassword <pw> [-TenantName <name>]   Erstregistrierung (Token und Passwort besser per
#                 Umgebung SM_LICENSE_TOKEN und SM_ADMIN_PASSWORD); -Strict: Fehler beenden das Skript mit Code 15/16
#   -RecoveryKit <ordner>  Passphrase aus -RecoveryPassphrase oder SM_RECOVERY_PASSPHRASE (mindestens 12 Zeichen)
#   -AcceptEula   Zustimmung zum Endnutzer-Lizenzvertrag (noetig ohne Rueckfrage-Moeglichkeit); -Unattended: keine Rueckfragen
#   -Force        auch eine neuere installierte Version ueberschreiben;  -FullBackup  Update mit Sicherung der Dokumente
#   -DryRun       nur pruefen und anzeigen;  -Uninstall [-RemoveData]  ruft tools\uninstall.ps1 auf
# Umgebungsvariablen:
#   SM_VERSION, SM_SOURCE_DIR, SM_DOWNLOAD_DIR (Arbeitsordner, Standard $env:TEMP\SovereignMind-Install), SM_KEEP=1, SM_SETUP_ARGS, SM_DRY_RUN=1,
#   SM_ELEVATE y/n (Frage "in neuem Administrator-Fenster fortfahren?" vorab beantworten), SM_CHAT_HOST, SM_ADMIN_HOST
#   SM_REQUIRE_SIGNATURE  leer (Standard): Signatur von SHA256SUMS.txt mit minisign.exe pruefen, wenn vorhanden, sonst Warnung und nur
#                 Pruefsummen; 1: Pruefung erzwingen; 0: Release ohne Signatur zulassen (aeltere Versionen). Ungueltige Signatur bricht immer ab.
#   SM_SKIP_HW_CHECK=1  Hardware-Hinweis (empfohlen: 16 GB RAM, 8 GB Grafikspeicher) ueberspringen; der Hinweis bricht nie ab
#   Nur fuer Tests: SM_RAM_KB, SM_VRAM_MB, SM_API_URL, SM_BASE_URL, SM_FREE_KB, SM_FREE_INSTALL_KB, SM_NO_ELEVATE=1, SM_IS_ADMIN=0/1, SM_ELEVATE_DRY=1, SM_NO_SERVICE_CHECK=1,
#   SM_REGISTRY_ROOT (Standard HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall), SM_STARTMENU_DIR, SM_MINISIGN_PUBKEY,
#   SM_ACL_DRY=1 (Rechte des Installationsordners nur anzeigen)
# Zielordner: neu, leer oder eine SovereignMind-Installation; ein fremder, nicht leerer Ordner wird abgelehnt. Die Installation legt dort die
# Markerdatei .sovereignmind-installdir an (nur dann loescht tools\uninstall.ps1 den Ordner). Ausserhalb von %ProgramFiles% bekommt der Ordner
# die Rechte wie unter Program Files (Administratoren und SYSTEM Vollzugriff, Benutzer und Dienste nur Lesen und Ausfuehren).
# Administratorrechte: Laeuft PowerShell schon als Administrator, geht es ohne Abfrage weiter. Sonst fragt das Skript vor dem Download,
# ob es in einem neuen Administrator-Fenster weitermachen soll (UAC sofort); bei "n" kommt die UAC-Abfrage nach dem Download.
# Windows-Hinweis: eine heruntergeladene .ps1 blockiert SmartScreen/Ausfuehrungsrichtlinie; "Unblock-File .\install.ps1" oder
# "powershell -ExecutionPolicy Bypass -File .\install.ps1" (der Einzeiler irm | iex umgeht beides).
# Ergebnis: $global:LASTEXITCODE (0 Erfolg, 1 Fehler, 11-13 Einrichtung der Dienste fehlgeschlagen, 15 Modelle, 16 Registrierung); das Skript
# beendet die Sitzung nie.

function Install-SovereignMind {
    [CmdletBinding()]
    param(
        [string]$Version, [string]$Variant, [string]$SourceDir, [string]$InstallDir, [string]$DataDir,
        [string]$Port, [switch]$PortAuto, [switch]$Lan, [string]$LanAddress, [string]$LanBackend, [string]$LanChat, [string]$LanAdmin,
        [string]$PublicHost, [string]$AdminHost, [string]$TlsMode, [string]$DnsProvider, [string]$Cors,
        [string]$Frontend, [string]$HwAgent, [string]$PawnIO, [string]$Llm, [string]$Models, [string]$Config, [switch]$SkipPython,
        [string]$PgPort, [string]$QdrantPort, [string]$QdrantGrpcPort, [string]$IngestionPort, [string]$VoicePort,
        [string]$LicenseEmail, [string]$LicenseToken, [string]$AdminPassword, [string]$TenantName,
        [switch]$Strict, [string]$RecoveryKit, [string]$RecoveryPassphrase, [switch]$FullBackup,
        [switch]$AcceptEula, [switch]$Unattended, [switch]$Force, [switch]$DryRun, [switch]$Uninstall, [switch]$RemoveData,
        [string]$SetupArgs
    )

    $ErrorActionPreference = "Stop"
    $repo = "sovereignmind-deutschland/sovereignmind-installer"
    $apiUrl = if ($env:SM_API_URL) { $env:SM_API_URL } else { "https://api.github.com/repos/$repo/releases/latest" }
    $baseUrl = if ($env:SM_BASE_URL) { $env:SM_BASE_URL } else { "https://github.com/$repo/releases/download" }
    $workDir = if ($env:SM_DOWNLOAD_DIR) { $env:SM_DOWNLOAD_DIR } else { Join-Path $env:TEMP "SovereignMind-Install" }
    $registryRoot = if ($env:SM_REGISTRY_ROOT) { $env:SM_REGISTRY_ROOT } else { "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" }
    $startMenuDir = if ($env:SM_STARTMENU_DIR) { $env:SM_STARTMENU_DIR } else { Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs" }
    $innoKey = "{7B1E5C42-3D6A-4E0F-9A58-5C2B8F1D6E73}_is1"   # Eintrag der frueheren Inno-Setup-Installation
    $keepOnError = $false
    $workCreated = $false
    $installMarkerName = ".sovereignmind-installdir"
    # Oeffentlicher minisign-Schluessel fuer SHA256SUMS.txt; derselbe steht in install.sh, in minisign.pub und auf der Download-Seite
    # (Abschnitt Pruefsummen). Solange hier der Platzhalter steht, wird die Signatur nicht geprueft.
    $minisignPubKey = if ($env:SM_MINISIGN_PUBKEY) { $env:SM_MINISIGN_PUBKEY } else { "PLATZHALTER_MINISIGN_PUBKEY" }
    $secretNames = "LicenseToken", "AdminPassword", "RecoveryPassphrase"
    $global:LASTEXITCODE = 0

    function Status($text) { Write-Host ">>> $text" }
    function Fail($text) { throw [System.InvalidOperationException]::new($text) }

    # --- Optionen: Parameter vor SM_SETUP_ARGS (alte Schreibweise /NAME=wert) vor Umgebung -------------------------------------
    $switchNames = "Lan", "PortAuto", "SkipPython", "Strict", "FullBackup", "AcceptEula", "Unattended", "Force", "DryRun", "Uninstall", "RemoveData"
    $stringNames = "Version", "Variant", "SourceDir", "InstallDir", "DataDir", "Port", "LanAddress", "LanBackend", "LanChat", "LanAdmin", "PublicHost", "AdminHost",
    "TlsMode", "DnsProvider", "Cors", "Frontend", "HwAgent", "PawnIO", "Llm", "Models", "Config", "PgPort", "QdrantPort", "QdrantGrpcPort", "IngestionPort",
    "VoicePort", "LicenseEmail", "LicenseToken", "AdminPassword", "TenantName", "RecoveryKit", "RecoveryPassphrase"
    $canonical = @{}
    foreach ($n in $switchNames + $stringNames) { $canonical[$n.ToLowerInvariant()] = $n }

    function ConvertTo-Bool($value) {
        if ($value -is [bool]) { return $value }
        return ("$value".Trim().ToLowerInvariant() -in "1", "true", "yes", "ja", "j", "y", "on", "an")
    }

    # "/PORT=8443 /FRONTEND=off -AcceptEula --lan-backend on" -> @{ Port = "8443"; Frontend = "off"; ... }
    function ConvertFrom-SetupArgs([string]$text) {
        $result = @{}
        if (-not $text) { return $result }
        $tokens = @([regex]::Matches($text, '("[^"]*"|''[^'']*''|\S)+') | ForEach-Object { $_.Value.Trim() -replace '^"(.*)"$', '$1' -replace "^'(.*)'$", '$1' })
        for ($i = 0; $i -lt $tokens.Count; $i++) {
            $token = $tokens[$i]
            if ($token -notmatch '^(?:/|--?)([A-Za-z][A-Za-z0-9-]*)(?:[=:](.*))?$') { Write-Warning "Option '$token' wird ignoriert."; continue }
            $name = $Matches[1].ToLowerInvariant() -replace "-", ""
            $hasValue = $Matches.ContainsKey(2) -and $null -ne $Matches[2]
            $value = if ($hasValue) { $Matches[2] } else { $null }
            if ($name -in "verysilent", "silent") { $result["Unattended"] = $true; $result["AcceptEula"] = $true; continue }   # wie das alte Setup: stiller Modus gilt als Zustimmung
            if ($name -in "suppressmsgboxes", "norestart", "nocancel", "nodebug") { continue }
            if ($name -in "log", "dir", "group", "lang", "loadinf", "saveinf") { if (-not $hasValue -and $i + 1 -lt $tokens.Count) { $i++ }; continue }
            if (-not $canonical.ContainsKey($name)) { Write-Warning "Unbekannte Option '$token' wird ignoriert."; continue }
            $key = $canonical[$name]
            if ($switchNames -contains $key) { $result[$key] = if ($hasValue) { ConvertTo-Bool $value } else { $true }; continue }
            if (-not $hasValue) { if ($i + 1 -lt $tokens.Count -and $tokens[$i + 1] -notmatch '^(/|--?)[A-Za-z]') { $i++; $value = $tokens[$i] } else { $value = "" } }
            $result[$key] = "$value".Trim().Trim('"', "'")   # /InstallDir="C:\Pfad mit Leerzeichen"
        }
        return $result
    }

    $o = @{}
    $aliasText = if ($SetupArgs) { $SetupArgs } else { $env:SM_SETUP_ARGS }
    foreach ($e in (ConvertFrom-SetupArgs $aliasText).GetEnumerator()) { $o[$e.Key] = $e.Value }
    foreach ($k in $PSBoundParameters.Keys) {
        if ($k -eq "SetupArgs") { continue }
        $v = $PSBoundParameters[$k]
        $o[$k] = if ($v -is [switch]) { [bool]$v } else { $v }
    }
    foreach ($pair in @(@("Version", "SM_VERSION"), @("SourceDir", "SM_SOURCE_DIR"), @("PublicHost", "SM_CHAT_HOST"), @("AdminHost", "SM_ADMIN_HOST"),
            @("RecoveryPassphrase", "SM_RECOVERY_PASSPHRASE"), @("LicenseToken", "SM_LICENSE_TOKEN"), @("AdminPassword", "SM_ADMIN_PASSWORD"))) {
        $envValue = [Environment]::GetEnvironmentVariable($pair[1])
        if (-not $o.ContainsKey($pair[0]) -and $envValue) { $o[$pair[0]] = $envValue }
    }
    if ($env:SM_DRY_RUN -eq "1") { $o["DryRun"] = $true }
    function Has([string]$name) { return $o.ContainsKey($name) -and "$($o[$name])" -ne "" }
    function Flag([string]$name) { return $o.ContainsKey($name) -and (ConvertTo-Bool $o[$name]) }
    function OnOff([string]$value) { if (ConvertTo-Bool $value) { "on" } else { "off" } }

    # --- Hilfsfunktionen -------------------------------------------------------------------------------------------------------
    function Get-Curl {
        $c = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) { $c.Source } else { $null }
    }

    # Download mit Wiederaufnahme: curl.exe (ab Windows 10 1803), Rueckfall BITS
    function Receive-File([string]$url, [string]$target) {
        $curl = Get-Curl
        if ($curl) {
            & $curl --fail --show-error --location --silent --show-error -C - -o $target $url
            if ($LASTEXITCODE -ne 0) { Fail "Download fehlgeschlagen (curl Exit $LASTEXITCODE): $url" }
        }
        elseif (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
            Start-BitsTransfer -Source $url -Destination $target -DisplayName "SovereignMind"
        }
        else {
            Fail "Weder curl.exe noch BITS vorhanden. Windows 10 ab Version 1803 wird benoetigt."
        }
    }

    function Test-Admin {
        if ($env:SM_IS_ADMIN) { return ($env:SM_IS_ADMIN -eq "1") }
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return ([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }

    function Test-Interactive {
        if (Flag "Unattended") { return $false }
        try { return ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) } catch { return $false }
    }

    # Ja/Nein im Terminal; ohne Terminal $default
    function Read-YesNo([string]$question, [bool]$default = $false, [string]$presetEnv = "") {
        if ($presetEnv -and [Environment]::GetEnvironmentVariable($presetEnv)) { return ([Environment]::GetEnvironmentVariable($presetEnv).Trim().ToLowerInvariant() -in "y", "j", "ja", "yes", "1") }
        if (-not (Test-Interactive)) { return $default }
        while ($true) {
            $a = "$(Read-Host "$question [j/n]")".Trim().ToLowerInvariant()
            if ($a -in "y", "j", "ja", "yes") { return $true }
            if ($a -in "n", "nein", "no") { return $false }
            if ($a -eq "") { return $default }
            Write-Host "Bitte j oder n eingeben."
        }
    }

    function Test-Sum([hashtable]$sums, [string]$name, [string]$file) {
        if (-not $sums.ContainsKey($name) -or -not (Test-Path -LiteralPath $file)) { return $false }
        return ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sums[$name])
    }

    # Signatur von SHA256SUMS.txt (minisign, Entscheidung E4). Ohne minisign.exe nur eine Warnung (SM_REQUIRE_SIGNATURE=1 erzwingt die
    # Pruefung), ein Release ohne Signatur nur mit SM_REQUIRE_SIGNATURE=0; eine ungueltige Signatur bricht immer ab.
    function Test-SumsSignature([string]$sumsFile, [string]$sigFile, [string]$sigUrl) {
        $require = "$env:SM_REQUIRE_SIGNATURE"
        if ($minisignPubKey -like "PLATZHALTER*") {
            if ($require -eq "1") { Fail "SM_REQUIRE_SIGNATURE=1, aber dieses Skript enthaelt noch keinen oeffentlichen minisign-Schluessel." }
            Write-Warning "Signaturpruefung uebersprungen: dieses Skript enthaelt noch keinen oeffentlichen minisign-Schluessel. Geprueft werden nur die SHA-256-Pruefsummen."
            return
        }
        $minisign = Get-Command minisign -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $minisign) {
            if ($require -eq "1") { Fail "minisign fehlt (SM_REQUIRE_SIGNATURE=1). Installieren: winget install jedisct1.minisign" }
            Write-Warning "minisign ist nicht installiert: die Signatur von SHA256SUMS.txt wird nicht geprueft, nur die SHA-256-Pruefsummen. Empfohlen: 'winget install jedisct1.minisign' und erneut starten; `$env:SM_REQUIRE_SIGNATURE = '1' erzwingt die Pruefung."
            return
        }
        if ($sigUrl) {
            Remove-Item -LiteralPath $sigFile -Force -ErrorAction SilentlyContinue
            try { Receive-File $sigUrl $sigFile } catch { Remove-Item -LiteralPath $sigFile -Force -ErrorAction SilentlyContinue }
        }
        if (-not (Test-Path -LiteralPath $sigFile)) {
            if ($require -eq "0") { Write-Warning "Keine Signatur (SHA256SUMS.txt.minisig); SM_REQUIRE_SIGNATURE=0: nur Pruefsummen."; return }
            Fail "Keine Signatur gefunden (SHA256SUMS.txt.minisig). Aeltere Versionen ohne Signatur nur mit `$env:SM_REQUIRE_SIGNATURE = '0'."
        }
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $minisign.Source -V -q -P $minisignPubKey -m $sumsFile -x $sigFile *> $null
        $code = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($code -ne 0) { Fail "Die Signatur von SHA256SUMS.txt ist ungueltig. Nichts wurde installiert. Bitte nicht erneut versuchen, sondern den Anbieter informieren (Download-Seite, Abschnitt Pruefsummen)." }
        Status "Signatur von SHA256SUMS.txt geprueft (minisign)."
    }

    # Pfade, die weder Installations- noch Datenordner sein duerfen (Installer-Review, Fund 7): Laufwerkswurzeln, Windows, Program Files,
    # ProgramData, der Benutzerordner und das eigene Profil.
    function Test-DangerousDir([string]$dir) {
        if (-not $dir -or $dir -match '^[A-Za-z]:\\?$') { return $true }   # Laufwerk ohne Pfad (GetFullPath machte aus "C:" den aktuellen Ordner)
        try { $full = [IO.Path]::GetFullPath($dir).TrimEnd("\") } catch { return $true }
        if ($full -match '^[A-Za-z]:$' -or $full -match '^\\\\[^\\]+\\[^\\]+$' -or $full.Length -lt 4) { return $true }
        $profileParent = if ($env:USERPROFILE) { Split-Path -Parent $env:USERPROFILE } else { "" }
        $blocked = @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData, $env:USERPROFILE, $profileParent, $env:SystemDrive) |
            Where-Object { $_ } | ForEach-Object { $_.TrimEnd("\") }
        return [bool]($blocked | Where-Object { $_ -ieq $full })
    }

    # Zielordner (Fund 7): neu, leer, mit Markerdatei oder eine fruehere SovereignMind-Installation (eingetragener Ort unter "Apps & Features"
    # bzw. VERSION und tools\install-native.ps1).
    # Ein fremder, nicht leerer Ordner wird abgelehnt: die Deinstallation loeschte sonst fremde Dateien mit.
    function Test-InstallTarget([string]$dir) {
        if (Test-DangerousDir $dir) { Fail "$dir ist als Installationsordner nicht erlaubt (Laufwerk, Systemordner). Bitte einen eigenen Ordner angeben, z. B. D:\SovereignMind." }
        if (-not (Test-Path -LiteralPath $dir)) { return $false }
        $item = Get-Item -LiteralPath $dir -Force
        if (-not $item.PSIsContainer) { Fail "$dir ist eine Datei, kein Ordner." }
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail "$dir ist eine Verknuepfung (Junction oder Symlink). Bitte einen echten Ordner angeben." }
        if (Test-Path -LiteralPath (Join-Path $dir $installMarkerName)) { return $true }
        if ($installedDir -and $installedDir.TrimEnd("\") -ieq $dir.TrimEnd("\")) { return $true }
        if ((Test-Path -LiteralPath (Join-Path $dir "VERSION")) -and (Test-Path -LiteralPath (Join-Path $dir "tools\install-native.ps1"))) { return $true }
        if (@(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | Select-Object -First 1).Count -eq 0) { return $true }
        Fail "Der Zielordner $dir ist nicht leer und enthaelt keine SovereignMind-Installation. Bitte einen leeren oder neuen Ordner angeben (-InstallDir)."
    }

    # Eigener Installationsordner ausserhalb von %ProgramFiles% (Fund 4): vor dem Entpacken dieselben Rechte wie unter Program Files.
    # Administratoren und SYSTEM Vollzugriff, Benutzer und Dienste (S-1-5-6) nur Lesen und Ausfuehren, keine geerbten Rechte des
    # Laufwerks (dort oft "Authentifizierte Benutzer: Aendern"). Vorhandene Dateien (Update) gehen an die Administratoren und erben nur noch.
    function Protect-InstallDir([string]$dir, [bool]$existed) {
        $full = ([IO.Path]::GetFullPath($dir)).TrimEnd("\") + "\"
        foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }) {
            if ($full.StartsWith($pf.TrimEnd("\") + "\", [StringComparison]::OrdinalIgnoreCase)) { return }
        }
        $steps = @()
        if ($existed) { $steps += , @(@($dir, "/setowner", "*S-1-5-32-544", "/T", "/C", "/Q"), $false) }
        $steps += , @(@($dir, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-32-545:(OI)(CI)RX", "*S-1-5-6:(OI)(CI)RX", "/C", "/Q"), $true)
        if ($existed) { $steps += , @(@((Join-Path $dir "*"), "/reset", "/T", "/C", "/Q"), $false) }
        foreach ($step in $steps) {
            $arguments = $step[0]
            if ($env:SM_ACL_DRY -eq "1") { Status "Wuerde Rechte setzen: icacls $($arguments -join ' ')"; continue }
            & icacls.exe @arguments | Out-Null
            if ($LASTEXITCODE -ne 0) {
                if ($step[1]) { Fail "Die Rechte fuer $dir liessen sich nicht setzen (icacls Exit $LASTEXITCODE)." }
                Write-Warning "icacls $($arguments[1]) fuer $dir endete mit Exit $LASTEXITCODE (einzelne Dateien gesperrt?)."
            }
        }
        Status "Rechte fuer $dir gesetzt: Administratoren und SYSTEM Vollzugriff, Benutzer und Dienste nur Lesen und Ausfuehren."
    }

    function Read-Sums([string]$file) {
        $sums = @{}
        foreach ($line in (Get-Content -LiteralPath $file)) {
            if ($line -match '^([0-9a-fA-F]{64})[ \t]+\*?(.+?)\s*$') { $sums[$Matches[2]] = $Matches[1].ToLowerInvariant() }
        }
        return $sums
    }

    # Vier Teile einer Version "JJJJ.MM.TT.HHMM" als Zahl; fehlende oder ungueltige Teile zaehlen 0 (alte Versionen "JJJJ.MM.TT").
    function Compare-Version([string]$a, [string]$b) {
        $pa = @($a.Split(".")); $pb = @($b.Split("."))
        for ($i = 0; $i -lt 4; $i++) {
            $x = 0; $y = 0
            if ($i -lt $pa.Count) { [void][int]::TryParse($pa[$i].Trim(), [ref]$x) }
            if ($i -lt $pb.Count) { [void][int]::TryParse($pb[$i].Trim(), [ref]$y) }
            if ($x -lt $y) { return -1 }
            if ($x -gt $y) { return 1 }
        }
        return 0
    }

    # Hinweis, kein Abbruch: SovereignMind laeuft auch mit weniger, aber Antworten und Dokumentenverarbeitung werden dann langsam oder scheitern.
    # Empfohlen (Website): 16 GB RAM, 8 GB Grafikspeicher; etwas Spielraum, weil Windows weniger als den eingebauten Speicher meldet.
    function Test-Hardware {
        if ($env:SM_SKIP_HW_CHECK -eq "1") { return }
        $ramKb = [int64]0
        if ($env:SM_RAM_KB) { [void][int64]::TryParse($env:SM_RAM_KB, [ref]$ramKb) }
        else {
            try { $ramKb = [int64]((Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1024) } catch { $ramKb = 0 }
        }
        # Grafikspeicher: nur nvidia-smi ist verlaesslich (Win32_VideoController.AdapterRAM laeuft bei 4 GB ueber).
        $vramMb = [int64]0
        if ($env:SM_VRAM_MB) { [void][int64]::TryParse($env:SM_VRAM_MB, [ref]$vramMb) }
        elseif (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
            try {
                $values = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | ForEach-Object { $n = [int64]0; if ([int64]::TryParse($_.Trim(), [ref]$n)) { $n } }
                if ($values) { $vramMb = [int64]($values | Measure-Object -Maximum).Maximum }
            } catch { $vramMb = 0 }
        }
        if ($ramKb -gt 0 -and $ramKb -lt [int64]15 * 1024 * 1024) {
            Write-Warning ("Arbeitsspeicher: {0} GB erkannt, empfohlen sind 16 GB. Die Installation laeuft weiter; mit weniger Speicher koennen grosse Dokumente und lange Antworten scheitern." -f [int64]($ramKb / 1024 / 1024))
        }
        if ($vramMb -le 0) {
            Status "Grafikspeicher nicht ermittelt (keine NVIDIA-Karte mit nvidia-smi gefunden). Empfohlen sind 8 GB; ohne passende Grafikkarte antwortet die KI deutlich langsamer."
        }
        elseif ($vramMb -lt [int64]7 * 1024) {
            Write-Warning ("Grafikspeicher: {0} GB erkannt, empfohlen sind 8 GB. Die Installation laeuft weiter; die KI antwortet dann langsamer oder nutzt den Prozessor." -f [int64]($vramMb / 1024))
        }
    }

    function Get-FreeKb([string]$path) {
        $probe = $path
        while ($probe -and -not (Test-Path -LiteralPath $probe)) { $probe = Split-Path -Parent $probe }
        $root = if ($probe) { [IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $probe).Path) } else { [IO.Path]::GetPathRoot($env:TEMP) }
        return [int64]((New-Object System.IO.DriveInfo($root)).AvailableFreeSpace / 1024)
    }

    # Ausgabe geht an die Konsole, zurueck kommt nur der Exit-Code. Windows PowerShell 5.1 fuehrt die Skripte des Pakets aus.
    function Invoke-Script([string]$script, [string[]]$arguments) {
        $shell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
        if (-not (Test-Path -LiteralPath $shell)) { $shell = (Get-Process -Id $PID).Path }
        & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @arguments | Out-Host
        return $LASTEXITCODE
    }

    function Invoke-ScriptCaptured([string]$script, [string[]]$arguments, [ref]$output) {
        $ErrorActionPreference = "Continue"   # stderr der Kindprozesse wird mit 2>&1 zu Fehlerobjekten
        $shell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
        if (-not (Test-Path -LiteralPath $shell)) { $shell = (Get-Process -Id $PID).Path }
        $output.Value = (& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @arguments 2>&1 | ForEach-Object { "$_" }) -join "`n"
        return $LASTEXITCODE
    }

    # Dieses Skript in einem neuen PowerShell-Fenster mit Administratorrechten fortsetzen. Bei "irm | iex" gibt es keine
    # Skriptdatei: die Funktion wird mit den aufgeloesten Optionen in eine Datei unter %TEMP% geschrieben, die sich beim Start
    # selbst loescht. Das erhoehte Fenster erbt die Umgebungsvariablen nicht sicher, daher stehen sie in der Datei.
    # Rueckgabe: $true, wenn das neue Fenster gestartet wurde.
    # Geheimnisse (Lizenztoken, Admin-Passwort, Recovery-Passphrase) stehen nie im Klartext in dieser Datei (Installer-Review, Fund 6):
    # sie gehen als DPAPI-Blob (nur dieses Windows-Konto kann ihn lesen) in eine eigene Datei, die das neue Fenster sofort liest und
    # loescht. Erhoeht ein anderes Administratorkonto (Anmeldedaten in der UAC-Abfrage), fragt das neue Fenster erneut. Beide Dateien
    # raeumt zusaetzlich ein Hilfsprozess nach zwei Minuten weg, falls das neue Fenster nie startet (z. B. Gruppenrichtlinie, AppLocker).
    function Start-Elevated([hashtable]$resolved) {
        $vars = [ordered]@{ SM_DOWNLOAD_DIR = $workDir; SM_ELEVATED = "1" }
        foreach ($k in "SM_KEEP", "SM_API_URL", "SM_BASE_URL", "SM_FREE_KB", "SM_FREE_INSTALL_KB", "SM_REGISTRY_ROOT", "SM_STARTMENU_DIR", "SM_NO_SERVICE_CHECK", "SM_NO_ELEVATE",
            "SM_REQUIRE_SIGNATURE", "SM_MINISIGN_PUBKEY", "SM_ACL_DRY") {
            $v = [Environment]::GetEnvironmentVariable($k)
            if ($v) { $vars[$k] = $v }
        }
        $stem = Join-Path ([IO.Path]::GetTempPath()) ("SovereignMind-Install-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
        $file = "$stem.ps1"
        $secretFile = "$stem.secrets"
        $secretLines = @()
        foreach ($k in $secretNames) {
            if (-not $resolved.ContainsKey($k) -or "$($resolved[$k])" -eq "") { continue }
            $secure = New-Object Security.SecureString
            foreach ($c in "$($resolved[$k])".ToCharArray()) { $secure.AppendChar($c) }
            $secretLines += "$k=$(ConvertFrom-SecureString -SecureString $secure)"
        }
        $lines = @(
            "# Automatisch erzeugt von install.ps1 (SovereignMind); loescht sich beim Start selbst. Enthaelt keine Geheimnisse.",
            'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue'
        )
        foreach ($k in $vars.Keys) { $lines += ('$env:{0} = ''{1}''' -f $k, ("$($vars[$k])" -replace "'", "''")) }
        $lines += "function Install-SovereignMind {"
        $lines += ${function:Install-SovereignMind}.ToString()
        $lines += "}"
        $lines += '$sm = @{}'
        foreach ($k in $resolved.Keys) {
            if ($secretNames -contains $k) { continue }
            if ($resolved[$k] -is [bool]) { $lines += ('$sm[''{0}''] = ${1}' -f $k, $resolved[$k].ToString().ToLowerInvariant()) }
            else { $lines += ('$sm[''{0}''] = ''{1}''' -f $k, ("$($resolved[$k])" -replace "'", "''")) }
        }
        if ($secretLines.Count -gt 0) {
            $lines += ('$smSecretFile = ''{0}''' -f ($secretFile -replace "'", "''"))
            $lines += ('$smSecretNames = @({0})' -f ((@($secretLines | ForEach-Object { "'" + $_.Split("=")[0] + "'" })) -join ", "))
            $lines += @'
$smSecrets = @{}
if (Test-Path -LiteralPath $smSecretFile) {
    foreach ($smLine in @(Get-Content -LiteralPath $smSecretFile)) {
        $smPair = $smLine.Split("=", 2)
        try { $smSecrets[$smPair[0]] = [Net.NetworkCredential]::new("", (ConvertTo-SecureString $smPair[1])).Password } catch { }
    }
    Remove-Item -LiteralPath $smSecretFile -Force -ErrorAction SilentlyContinue
}
foreach ($smName in $smSecretNames) {
    if ($smSecrets.ContainsKey($smName)) { continue }
    $smLabel = @{ LicenseToken = "Lizenzschluessel"; AdminPassword = "Admin-Passwort"; RecoveryPassphrase = "Passphrase des Recovery-Kits" }[$smName]
    Write-Warning "$smLabel liess sich nicht uebernehmen (anderes Administratorkonto oder Datei fehlt)."
    try { $smInteractive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected } catch { $smInteractive = $false }
    if ($smInteractive) {
        $smSecure = Read-Host "$smLabel bitte erneut eingeben" -AsSecureString
        $smSecrets[$smName] = [Net.NetworkCredential]::new("", $smSecure).Password
    }
}
foreach ($smName in $smSecrets.Keys) { $sm[$smName] = $smSecrets[$smName] }
'@
        }
        $lines += 'Install-SovereignMind @sm'
        $lines += 'if ($env:SM_NO_ELEVATE -ne "1") { Write-Host ""; Read-Host "Enter druecken, um das Fenster zu schliessen" | Out-Null }'
        $lines += 'exit $global:LASTEXITCODE'
        if ($secretLines.Count -gt 0) { [IO.File]::WriteAllLines($secretFile, [string[]]$secretLines, [Text.UTF8Encoding]::new($false)) }
        [IO.File]::WriteAllText($file, ($lines -join "`r`n"), [Text.UTF8Encoding]::new($true))
        if ($env:SM_ELEVATE_DRY -eq "1") {
            Status "Wuerde mit Administratorrechten fortsetzen: $file"
            return $true
        }
        $shell = (Get-Process -Id $PID).Path
        try {
            Start-Process -FilePath $shell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$file`"" | Out-Null
        }
        catch {
            Remove-Item -LiteralPath $file, $secretFile -Force -ErrorAction SilentlyContinue
            Write-Host "Die Windows-Sicherheitsabfrage wurde abgelehnt oder abgebrochen." -ForegroundColor Yellow
            return $false
        }
        # Aufraeumen auch dann, wenn das neue Fenster das Skript nie ausfuehrt (Ausfuehrungsrichtlinie per Gruppenrichtlinie, AppLocker).
        $quoted = @($file, $secretFile | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ", "
        try {
            Start-Process -FilePath $shell -WindowStyle Hidden -ArgumentList @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                "Start-Sleep -Seconds 120; Remove-Item -LiteralPath $quoted -Force -ErrorAction SilentlyContinue") | Out-Null
        }
        catch { Write-Warning "Hilfsprozess zum Aufraeumen nicht gestartet; bitte $stem.* in %TEMP% loeschen, falls die Installation nicht startet." }
        return $true
    }

    # --- Archiv: Teile .zip.001 ... werden als ein Strom gelesen (kein zusammengesetztes Archiv auf der Platte noetig) ----------
    function Initialize-Archive {
        if ("SmArchive" -as [type]) { return }
        $source = @'
using System;
using System.IO;
using System.IO.Compression;
using System.Text;

public delegate void SmProgress(long done, long total, string name);

public class SmConcatStream : Stream
{
    private readonly string[] _files;
    private readonly long[] _starts;
    private readonly long _length;
    private long _pos;
    private int _index = -1;
    private FileStream _current;

    public SmConcatStream(string[] files)
    {
        _files = files;
        _starts = new long[files.Length];
        long total = 0;
        for (int i = 0; i < files.Length; i++) { _starts[i] = total; total += new FileInfo(files[i]).Length; }
        _length = total;
    }
    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return true; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return _length; } }
    public override long Position { get { return _pos; } set { _pos = value; } }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin)
    {
        if (origin == SeekOrigin.Begin) _pos = offset;
        else if (origin == SeekOrigin.Current) _pos += offset;
        else _pos = _length + offset;
        return _pos;
    }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    public override int Read(byte[] buffer, int offset, int count)
    {
        int total = 0;
        while (count > 0 && _pos < _length)
        {
            int index = _index;
            if (index < 0 || _pos < _starts[index] || (index + 1 < _files.Length && _pos >= _starts[index + 1]))
            {
                index = 0;
                while (index + 1 < _files.Length && _pos >= _starts[index + 1]) index++;
            }
            if (index != _index)
            {
                if (_current != null) _current.Dispose();
                _current = new FileStream(_files[index], FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16);
                _index = index;
            }
            long within = _pos - _starts[index];
            if (_current.Position != within) _current.Position = within;
            long remaining = (index + 1 < _files.Length ? _starts[index + 1] : _length) - _pos;
            int want = (int)Math.Min((long)count, remaining);
            int got = _current.Read(buffer, offset, want);
            if (got <= 0) break;
            _pos += got; offset += got; count -= got; total += got;
        }
        return total;
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing && _current != null) { _current.Dispose(); _current = null; }
        base.Dispose(disposing);
    }
}

public static class SmArchive
{
    public static long LastBytes;

    private static string Normalize(string name) { return name.Replace('\\', '/'); }

    private static ZipArchiveEntry Find(ZipArchive zip, string name)
    {
        string wanted = Normalize(name);
        foreach (ZipArchiveEntry e in zip.Entries)
            if (string.Equals(Normalize(e.FullName), wanted, StringComparison.OrdinalIgnoreCase)) return e;
        return null;
    }

    public static string ReadText(string[] parts, string name)
    {
        using (ZipArchive zip = new ZipArchive(new SmConcatStream(parts), ZipArchiveMode.Read))
        {
            ZipArchiveEntry e = Find(zip, name);
            if (e == null) return null;
            using (StreamReader r = new StreamReader(e.Open(), new UTF8Encoding(false), true)) return r.ReadToEnd();
        }
    }

    public static bool ExtractOne(string[] parts, string name, string target)
    {
        using (ZipArchive zip = new ZipArchive(new SmConcatStream(parts), ZipArchiveMode.Read))
        {
            ZipArchiveEntry e = Find(zip, name);
            if (e == null) return false;
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            using (Stream input = e.Open())
            using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                input.CopyTo(output);
            return true;
        }
    }

    public static int Extract(string[] parts, string destDir, SmProgress progress)
    {
        string root = Path.GetFullPath(destDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        Directory.CreateDirectory(root);
        int count = 0;
        long done = 0, total = 0;
        DateTime lastReport = DateTime.MinValue;
        using (ZipArchive zip = new ZipArchive(new SmConcatStream(parts), ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry e in zip.Entries) total += e.Length;
            LastBytes = total;
            byte[] buffer = new byte[1 << 20];
            foreach (ZipArchiveEntry e in zip.Entries)
            {
                string name = Normalize(e.FullName);
                string target = Path.GetFullPath(Path.Combine(root, name.Replace('/', Path.DirectorySeparatorChar)));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase) && target + Path.DirectorySeparatorChar != root)
                    throw new InvalidDataException("Ungueltiger Pfad im Archiv: " + e.FullName);
                if (name.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (Stream input = e.Open())
                using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20))
                {
                    int read;
                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        output.Write(buffer, 0, read);
                        done += read;
                        if (progress != null && (DateTime.UtcNow - lastReport).TotalSeconds >= 2) { lastReport = DateTime.UtcNow; progress(done, total, name); }
                    }
                }
                try { File.SetLastWriteTimeUtc(target, e.LastWriteTime.UtcDateTime); } catch (Exception) { }
                count++;
            }
        }
        if (progress != null) progress(total, total, "");
        return count;
    }
}
'@
        Add-Type -TypeDefinition $source -ReferencedAssemblies "System.IO.Compression"
    }

    # --- Eintrag unter "Apps & Features", Startmenue --------------------------------------------------------------------------------
    function Register-Installation([string]$dir, [string]$version, [string]$data, [string]$webPort, [long]$bytes) {
        $key = Join-Path $registryRoot "SovereignMind"
        New-Item -Path $key -Force | Out-Null
        $uninstall = Join-Path $dir "tools\uninstall.ps1"
        $shell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $trayExe = Join-Path $dir "tray\SovereignMind.Tool.TrayApp.exe"
        $values = [ordered]@{
            DisplayName = "SovereignMind"; DisplayVersion = $version; Publisher = "SovereignMind"; InstallLocation = $dir
            DisplayIcon = $trayExe; InstallDate = (Get-Date -Format "yyyyMMdd")
            UninstallString = "`"$shell`" -NoProfile -ExecutionPolicy Bypass -File `"$uninstall`""
            QuietUninstallString = "`"$shell`" -NoProfile -ExecutionPolicy Bypass -File `"$uninstall`" -Quiet"
        }
        foreach ($name in $values.Keys) { New-ItemProperty -Path $key -Name $name -Value $values[$name] -PropertyType String -Force | Out-Null }
        New-ItemProperty -Path $key -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
        New-ItemProperty -Path $key -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null
        if ($bytes -gt 0) { New-ItemProperty -Path $key -Name "EstimatedSize" -Value ([int][Math]::Min([int64][int]::MaxValue, [int64]($bytes / 1024))) -PropertyType DWord -Force | Out-Null }
        # Alte Inno-Installation abloesen: Eintrag und Deinstallierer entfernen, sonst stuende SovereignMind doppelt unter "Apps".
        Remove-Item -LiteralPath (Join-Path $registryRoot $innoKey) -Recurse -Force -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $dir -Filter "unins000.*" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

        New-Item -ItemType Directory -Force $startMenuDir | Out-Null
        try {
            $wsh = New-Object -ComObject WScript.Shell
            foreach ($link in @(@("SovereignMind Control.lnk", $trayExe), @("SovereignMind API-Dokumentation.lnk", (Join-Path $dir "docs\api\README.md")))) {
                $shortcut = $wsh.CreateShortcut((Join-Path $startMenuDir $link[0]))
                $shortcut.TargetPath = $link[1]
                $shortcut.WorkingDirectory = Split-Path $link[1]
                $shortcut.Save()
            }
        }
        catch { Write-Warning "Startmenue-Verknuepfungen konnten nicht angelegt werden: $($_.Exception.Message)" }
        [IO.File]::WriteAllText((Join-Path $startMenuDir "SovereignMind $([char]0xF6)ffnen.url"), "[InternetShortcut]`r`nURL=http://localhost:$webPort`r`n", [Text.Encoding]::ASCII)
    }

    # --- KI-Modelle (Variante minimal): Lader im Hintergrund, Fortschritt als Text im Terminal ---------------------------------------
    function Read-ProgressFile([string]$file) {
        $values = @{}
        try {
            foreach ($line in [IO.File]::ReadAllLines($file, [Text.Encoding]::UTF8)) {
                $line = $line.TrimStart([char]0xFEFF)
                $i = $line.IndexOf("=")
                if ($i -gt 0) { $values[$line.Substring(0, $i)] = $line.Substring($i + 1).Trim() }
            }
        }
        catch { }
        return $values
    }

    # Rueckgabe: done, failed, cancelled, skipped oder crashed (kein Lebenszeichen mehr)
    function Invoke-ModelLoad([string]$dir, [string]$data, [string]$groups) {
        $python = Join-Path $dir "python\python.exe"
        $loader = Join-Path $dir "tools\load-models.py"
        $logDir = Join-Path $data "logs"
        New-Item -ItemType Directory -Force $logDir | Out-Null
        $progressBase = Join-Path $logDir "model-progress"
        foreach ($suffix in ".txt", ".json", ".json.cancel") { Remove-Item -LiteralPath ($progressBase + $suffix) -Force -ErrorAction SilentlyContinue }
        $logFile = Join-Path $logDir "model-load.log"
        $errFile = Join-Path $logDir "model-load.err.log"
        $argText = '"{0}" --install-dir "{1}" --data-dir "{2}" --groups {3} --text-progress "{4}"' -f $loader, $dir, $data, $groups, ($progressBase + ".txt")
        $process = Start-Process -FilePath $python -ArgumentList $argText -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $errFile
        Status "Lade KI-Modelle aus dem Internet (huggingface.co). Abbrechen mit Strg+C: bereits Geladenes bleibt, den Rest holt der Admin spaeter im Admin-Bereich."
        $outcome = "crashed"
        $lastHeartbeat = ""; $lastChange = Get-Date; $lastLine = ""
        try {
            while ($true) {
                Start-Sleep -Seconds 2
                $v = if (Test-Path -LiteralPath ($progressBase + ".txt")) { Read-ProgressFile ($progressBase + ".txt") } else { @{} }
                if ($v.Count -gt 0) {
                    if ($v["heartbeat"] -ne $lastHeartbeat) { $lastHeartbeat = $v["heartbeat"]; $lastChange = Get-Date }
                    $label = if ($v["label"]) { $v["label"] } else { "KI-Modelle werden vorbereitet ..." }
                    $line = "    {0}{1}" -f $label, $(if ($v["percent"] -and [int]$v["percent"] -ge 0) { " ($($v['percent']) %)" } else { "" })
                    if ($line -ne $lastLine) { Write-Host $line; $lastLine = $line }
                    if ($v["state"] -in "done", "failed", "cancelled", "skipped") { $outcome = $v["state"]; break }
                }
                if ($process.HasExited) {
                    if ($process.ExitCode -eq 0 -and -not $v["state"]) { $outcome = "done" }
                    elseif ($v["state"] -in "done", "failed", "cancelled", "skipped") { $outcome = $v["state"] }
                    elseif ($process.ExitCode -eq 0) { $outcome = "done" }
                    elseif ($process.ExitCode -eq 4) { $outcome = "cancelled" }
                    else { $outcome = "failed" }
                    break
                }
                if (((Get-Date) - $lastChange).TotalSeconds -gt 180) { Write-Warning "Kein Lebenszeichen des Laders seit 180 Sekunden, siehe $logFile"; break }
            }
        }
        finally {
            if (-not $process.HasExited) {
                # Strg+C oder Abbruch: den Lader sauber beenden lassen (Teil-Downloads bleiben liegen)
                try { [IO.File]::WriteAllText(($progressBase + ".json.cancel"), "1") } catch { }
                if (-not $process.WaitForExit(20000)) { try { $process.Kill() } catch { } }
            }
        }
        return $outcome
    }

    function Export-RecoveryKit([string]$dir, [string]$folder, [string]$passphrase, [ref]$message) {
        $script = Join-Path $dir "tools\recovery-kit.ps1"
        $env:SM_RECOVERY_PASSPHRASE = $passphrase
        try {
            $text = ""
            $code = Invoke-ScriptCaptured $script @("export", "--out", $folder) ([ref]$text)
            if ($code -eq 0) {
                $kit = ($text -split "`n" | Where-Object { $_ -like "KIT=*" } | Select-Object -First 1)
                $message.Value = if ($kit) { $kit.Substring(4).Trim() } else { $folder }
                $ignored = ""
                if ((Invoke-ScriptCaptured $script @("confirm") ([ref]$ignored)) -ne 0) { Write-Warning "Die Bestaetigung des Recovery-Kits ist fehlgeschlagen (das Kit ist trotzdem gesichert)." }
                return $true
            }
            $message.Value = $text.Trim()
            if (-not $message.Value) { $message.Value = "Das Werkzeug lieferte keine Ausgabe (Code $code)." }
            return $false
        }
        finally { Remove-Item Env:\SM_RECOVERY_PASSPHRASE -ErrorAction SilentlyContinue }
    }

    function Read-Secret([string]$prompt) {
        $secure = Read-Host $prompt -AsSecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }

    try {
        # 1. Pruefungen
        if ($PSVersionTable.PSVersion.Major -lt 5) { Fail "PowerShell 5.1 oder 7 wird benoetigt (gefunden: $($PSVersionTable.PSVersion))." }
        if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) { Fail "Dieses Skript laeuft nur unter Windows (Linux: install.sh)." }
        if (-not [Environment]::Is64BitOperatingSystem) { Fail "Nur 64-Bit-Windows wird unterstuetzt." }
        if ([Environment]::OSVersion.Version.Build -lt 17763) { Fail "Windows 10 (1809) oder neuer bzw. Server 2019 oder neuer wird benoetigt (Build $([Environment]::OSVersion.Version.Build))." }
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
        if ((Has "Variant") -and "$($o['Variant'])".ToLowerInvariant() -notin "minimal", "full") { Fail "-Variant erwartet minimal oder full." }
        foreach ($name in "Port", "PgPort", "QdrantPort", "QdrantGrpcPort", "IngestionPort", "VoicePort") {
            if ((Has $name) -and "$($o[$name])" -notmatch '^[0-9 ,;]+$') { Fail "-$name erwartet eine Portnummer (oder bei -Port eine Liste, z. B. 5043,8080)." }
        }
        if ((Has "Version") -and "$($o['Version'])".TrimStart("v") -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') { Fail "Ungueltige Version '$($o['Version'])'." }

        $dataDir = if (Has "DataDir") { "$($o['DataDir'])" } else { Join-Path $env:ProgramData "SovereignMind" }

        # 2. Vorhandene Installation (neuer Eintrag, alter Inno-Eintrag, Dienst)
        $installedDir = ""
        foreach ($key in "SovereignMind", $innoKey) {
            $loc = (Get-ItemProperty -LiteralPath (Join-Path $registryRoot $key) -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation
            if ($loc) { $installedDir = "$loc".TrimEnd("\"); break }
        }
        $installed = [bool]$installedDir
        if (-not $installed -and $env:SM_NO_SERVICE_CHECK -ne "1" -and (Get-Service -Name "SovereignMind" -ErrorAction SilentlyContinue)) { $installed = $true }
        $installDir = if (Has "InstallDir") { "$($o['InstallDir'])".TrimEnd("\") } elseif ($installedDir) { $installedDir } else { Join-Path $env:ProgramFiles "SovereignMind" }
        $installedVersion = ""
        $versionFile = Join-Path $installDir "VERSION"
        if (Test-Path -LiteralPath $versionFile) { $installedVersion = ("$(Get-Content -LiteralPath $versionFile -TotalCount 1 -ErrorAction SilentlyContinue)").Trim() }
        if (-not $installedVersion -and $installed) {
            foreach ($key in "SovereignMind", $innoKey) {
                $dv = (Get-ItemProperty -LiteralPath (Join-Path $registryRoot $key) -Name DisplayVersion -ErrorAction SilentlyContinue).DisplayVersion
                if ($dv) { $installedVersion = "$dv".Trim(); break }
            }
        }

        if (Flag "Uninstall") {
            $uninstallScript = Join-Path $installDir "tools\uninstall.ps1"
            if (-not (Test-Path -LiteralPath $uninstallScript)) { Fail "tools\uninstall.ps1 nicht gefunden ($uninstallScript): SovereignMind ist hier nicht (vollstaendig) installiert." }
            $uargs = @("-InstallDir", $installDir, "-DataDir", $dataDir)
            if (Flag "RemoveData") { $uargs += "-RemoveData" }
            if (Flag "Unattended") { $uargs += "-Quiet" }
            $code = Invoke-Script $uninstallScript $uargs
            if ($code -ne 0) { Fail "Die Deinstallation endete mit Exit-Code $code." }
            return
        }

        # Zielordner pruefen, bevor etwas geladen wird (Fund 7)
        $installDirExisted = Test-InstallTarget $installDir

        # 3. Quelle: Teile im Ordner neben dem Skript (Offline) oder aus dem GitHub-Release
        $localDir = ""
        if (Has "SourceDir") { $localDir = "$($o['SourceDir'])" }
        elseif ($PSCommandPath -and $env:SM_ELEVATED -ne "1") { $localDir = Split-Path -Parent $PSCommandPath }
        $partPattern = '^SovereignMind-Setup-(Minimal|Full)-(.+)\.zip\.(\d{3})$'
        $local = $null
        if ($localDir -and (Test-Path -LiteralPath $localDir)) {
            $firsts = @(Get-ChildItem -LiteralPath $localDir -File -Filter "SovereignMind-Setup-*.zip.001" -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $partPattern })
            if (Has "Variant") { $wantName = if ("$($o['Variant'])".ToLowerInvariant() -eq "full") { "Full" } else { "Minimal" }; $firsts = @($firsts | Where-Object { $_.Name -like "SovereignMind-Setup-$wantName-*" }) }
            if (Has "Version") { $wantVersion = "$($o['Version'])".TrimStart("v"); $firsts = @($firsts | Where-Object { $_.Name -like "*-$wantVersion.zip.001" }) }
            if ($firsts.Count -gt 1) { Fail ("Im Ordner $localDir liegen mehrere Pakete (" + (($firsts | ForEach-Object Name) -join ", ") + "). -Variant und -Version waehlen eines.") }
            if ($firsts.Count -eq 1) { $local = $firsts[0] }
            elseif (Has "SourceDir") { Fail "In $localDir liegt kein Paket (SovereignMind-Setup-<Variante>-<Version>.zip.001)." }
        }

        if ($local) {
            [void]($local.Name -match $partPattern)
            $variantName = $Matches[1]; $version = $Matches[2]
            $variant = $variantName.ToLowerInvariant()
            $tagName = "v$version"
            Status "Version $version (Variante $variant), Teile aus $localDir"
        }
        else {
            $variant = if (Has "Variant") { "$($o['Variant'])".ToLowerInvariant() } else { "minimal" }
            $variantName = if ($variant -eq "full") { "Full" } else { "Minimal" }
            if (Has "Version") {
                $version = "$($o['Version'])".TrimStart("v")
            }
            else {
                Status "Ermittle die neueste Version ..."
                $curl = Get-Curl
                if (-not $curl) { Fail "curl.exe fehlt; Version mit -Version angeben, z. B. -Version 2026.11.12.1500." }
                $previousPreference = $ErrorActionPreference
                $ErrorActionPreference = "Continue"   # stderr von curl ist hier Text, kein Abbruchgrund (Windows PowerShell 5.1 macht daraus sonst eine Ausnahme)
                $json = & $curl --fail --silent --show-error --location -H "User-Agent: sovereignmind-install" $apiUrl 2>&1
                $curlCode = $LASTEXITCODE
                $ErrorActionPreference = $previousPreference
                if ($curlCode -ne 0) {
                    $msg = ($json | Out-String).Trim()
                    if ($msg -match "40[3]|429") { Fail "GitHub-API-Limit erreicht. Version angeben, z. B. -Version 2026.11.12.1500 (siehe Download-Seite)." }
                    Fail "Release nicht abrufbar: $msg"
                }
                $tag = $null
                try { $tag = ((($json | Out-String) | ConvertFrom-Json).tag_name) } catch { }
                if (-not $tag) { Fail "Kein 'tag_name' in der Antwort der Release-API." }
                $version = "$tag".TrimStart("v")
            }
            if ($version -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') { Fail "Ungueltige Version '$version'." }
            $tagName = "v$version"
            Status "Version $version (Variante $variant)"
            if (-not (Get-Curl) -and -not (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue)) { Fail "Weder curl.exe noch BITS vorhanden." }
        }
        $base = "$baseUrl/$tagName"

        # Installierte Version gegen die neue
        $mode = "install"
        if ($installed) {
            $cmp = if ($installedVersion) { Compare-Version $version $installedVersion } else { 1 }
            if ($cmp -lt 0 -and -not (Flag "Force")) {
                Status "Installiert ist schon die neuere Version $installedVersion (Paket: $version). Nichts zu tun (ueberschreiben mit -Force)."
                return
            }
            $mode = if ($cmp -eq 0) { "repair" } else { "update" }
            Status ("Vorhandene Installation: Version '{0}' in {1} - {2}." -f $installedVersion, $installDir, $(if ($mode -eq "repair") { "gleiche Version, Reparatur" } else { "Update (Daten bleiben erhalten)" }))
        }
        $updating = $installed

        # Platz: Arbeitsordner (nur beim Laden) und Installationslaufwerk
        $needWorkKb = if ($variant -eq "full") { [int64]12 * 1024 * 1024 } else { [int64]4 * 1024 * 1024 }
        $needInstallKb = [int64]14 * 1024 * 1024   # Programme, Python-Umgebungen und die Modelle (kurz doppelt)
        if (-not $local) {
            $freeKb = if ($env:SM_FREE_KB) { [int64]$env:SM_FREE_KB } else { Get-FreeKb $workDir }
            if ($freeKb -lt $needWorkKb) {
                Fail ("Zu wenig Platz in {0}: frei {1} MiB, noetig ca. {2} MiB. Anderen Ordner mit `$env:SM_DOWNLOAD_DIR waehlen." -f $workDir, [int64]($freeKb / 1024), [int64]($needWorkKb / 1024))
            }
        }
        $freeInstallKb = if ($env:SM_FREE_INSTALL_KB) { [int64]$env:SM_FREE_INSTALL_KB } else { Get-FreeKb $installDir }
        if ($freeInstallKb -lt $needInstallKb) {
            Fail ("Zu wenig Platz fuer die Installation in {0}: frei {1} MiB, noetig ca. {2} MiB." -f $installDir, [int64]($freeInstallKb / 1024), [int64]($needInstallKb / 1024))
        }
        Test-Hardware
        if ($variant -eq "minimal") { Write-Warning "Danach laedt die Installation ca. 11 GB KI-Modelle aus dem Internet; auf dem Systemlaufwerk ebenfalls genug Platz einplanen." }

        if (Flag "DryRun") {
            $what = if ($local) { "Teile aus $localDir pruefen" } else { "$base/SHA256SUMS.txt, EULA.de.txt und die Teile SovereignMind-Setup-$variantName-$version.zip.NNN nach $workDir laden" }
            Status "Trockenlauf: wuerde $what, nach $installDir entpacken und tools\install-native.ps1 aufrufen ($mode). Nichts wurde geaendert."
            return
        }

        # 4. Pruefsummen und Teile
        # Nur einen selbst angelegten Arbeitsordner spaeter loeschen (Fund 2). Die Markerdatei kennzeichnet ihn auch fuer einen spaeteren
        # Lauf (Wiederaufnahme nach einem Abbruch) und fuer die Fortsetzung im Administrator-Fenster; ein fremder Ordner bleibt stehen.
        $workMarker = Join-Path $workDir ".sovereignmind-download"
        if (-not (Test-Path -LiteralPath $workDir)) {
            New-Item -ItemType Directory -Force $workDir | Out-Null
            [IO.File]::WriteAllText($workMarker, "Arbeitsordner von install.ps1 (SovereignMind); wird nach der Installation geloescht.`r`n")
        }
        $workCreated = Test-Path -LiteralPath $workMarker
        $sums = @{}
        if ($local) {
            $sumsFile = Join-Path $localDir "SHA256SUMS.txt"
            if (-not (Test-Path -LiteralPath $sumsFile)) { Fail "SHA256SUMS.txt fehlt in $localDir (ohne Pruefsummen wird nichts installiert)." }
            Test-SumsSignature $sumsFile (Join-Path $localDir "SHA256SUMS.txt.minisig") ""
            $sums = Read-Sums $sumsFile
            $partDir = $localDir
        }
        else {
            $sumsFile = Join-Path $workDir "SHA256SUMS.txt"
            Status "Lade Pruefsummen ..."
            Remove-Item -LiteralPath $sumsFile -Force -ErrorAction SilentlyContinue
            Receive-File "$base/SHA256SUMS.txt" $sumsFile
            Test-SumsSignature $sumsFile "$sumsFile.minisig" "$base/SHA256SUMS.txt.minisig"
            $sums = Read-Sums $sumsFile
            $partDir = $workDir
        }
        $escaped = [regex]::Escape("SovereignMind-Setup-$variantName-$version.zip.")
        $partNames = @($sums.Keys | Where-Object { $_ -match ('^' + $escaped + '(\d{3})$') } | Sort-Object { [int]([regex]::Match($_, '(\d{3})$').Groups[1].Value) })
        if ($partNames.Count -eq 0) { Fail "Im Release $tagName gibt es kein Paket SovereignMind-Setup-$variantName-$version.zip.001." }
        for ($n = 0; $n -lt $partNames.Count; $n++) {
            if ([int]([regex]::Match($partNames[$n], '(\d{3})$').Groups[1].Value) -ne ($n + 1)) { Fail "Im Release $tagName fehlt Teil $($n + 1) des Pakets." }
        }

        # EULA: eigene Datei im Release (klein, vor dem grossen Download); sonst aus dem Paket (Offline-Ordner)
        $eulaFile = Join-Path $partDir "EULA.de.txt"
        if (-not $local) {
            if (-not $sums.ContainsKey("EULA.de.txt")) { Fail "Im Release $tagName fehlt EULA.de.txt." }
            if (-not (Test-Sum $sums "EULA.de.txt" $eulaFile)) {
                Receive-File "$base/EULA.de.txt" $eulaFile
                if (-not (Test-Sum $sums "EULA.de.txt" $eulaFile)) { Remove-Item -LiteralPath $eulaFile -Force -ErrorAction SilentlyContinue; Fail "Pruefsumme von EULA.de.txt stimmt nicht." }
            }
        }
        $eulaText = $null
        if (Test-Path -LiteralPath $eulaFile) { $eulaText = [IO.File]::ReadAllText($eulaFile, [Text.Encoding]::UTF8) }
        elseif ($local -and -not (Flag "AcceptEula")) {
            # Offline-Ordner ohne EULA.de.txt: den Text aus dem Paket lesen (nur das Ende des Archivs wird gelesen)
            try { Initialize-Archive; $eulaText = [SmArchive]::ReadText(@($partNames | ForEach-Object { Join-Path $partDir $_ }), "licenses/EULA.de.txt") } catch { }
        }

        # 5. EULA: Zustimmung per -AcceptEula oder im Terminal (kein Hineinreden ins stille Setup)
        if (Flag "AcceptEula") { Status "Endnutzer-Lizenzvertrag: Zustimmung durch -AcceptEula." }
        elseif (Test-Interactive) {
            if ($eulaText) { Write-Host ""; $eulaText | Out-Host -Paging; Write-Host "" }
            else { Write-Host "Der Lizenztext liegt im Paket (licenses\EULA.de.txt) und wird nach dem Entpacken nicht mehr angezeigt; Text unter https://sovereignmind-deutschland.github.io/sovereignmind-website/." }
            if (-not (Read-YesNo "Stimmen Sie dem Endnutzer-Lizenzvertrag zu?" $false "SM_ACCEPT_EULA")) { Fail "Ohne Zustimmung zum Endnutzer-Lizenzvertrag wird nicht installiert." }
        }
        else { Fail "Der Endnutzer-Lizenzvertrag braucht Ihre Zustimmung: mit -AcceptEula bestaetigen (Text: $eulaFile)." }

        # Registrierungsangaben gehoeren zusammen
        $regCount = @("LicenseEmail", "LicenseToken", "AdminPassword" | Where-Object { Has $_ }).Count
        if ($regCount -gt 0 -and $regCount -lt 3) { Fail "Die Erstregistrierung braucht -LicenseEmail, -LicenseToken und -AdminPassword zusammen." }

        # 6. Administratorrechte vor dem Download klaeren
        $isAdmin = Test-Admin
        if ($isAdmin) {
            Status "PowerShell laeuft als Administrator: die Installation laeuft ohne Windows-Sicherheitsabfrage durch."
        }
        elseif ($env:SM_NO_ELEVATE -ne "1" -and $env:SM_ELEVATED -ne "1") {
            Write-Host ""
            Write-Host "Die Installation braucht Administratorrechte. Die Windows-Sicherheitsabfrage (UAC) kaeme sonst erst nach dem Download."
            Write-Host "Mit 'j' erscheint die Abfrage jetzt, und die Installation laeuft in einem neuen Fenster mit Administratorrechten weiter."
            Write-Host "Mit 'n' geht es hier weiter; die Abfrage erscheint dann nach dem Download, bitte dann am Rechner sein."
            Write-Host "Tipp: PowerShell gleich als Administrator oeffnen, dann gibt es keine Abfrage."
            if (Read-YesNo "Jetzt in einem neuen Administrator-Fenster fortfahren?" $false "SM_ELEVATE") {
                $resolved = @{}
                foreach ($e in $o.GetEnumerator()) { $resolved[$e.Key] = $e.Value }
                $resolved["Version"] = $version
                $resolved["Variant"] = $variant
                $resolved["AcceptEula"] = $true
                if ($localDir -and -not (Has "SourceDir") -and $local) { $resolved["SourceDir"] = $localDir }
                if (Start-Elevated $resolved) {
                    Status "Die Installation laeuft im neuen Fenster weiter. Dieses Fenster kann geschlossen werden."
                    return
                }
            }
            Status "Weiter in diesem Fenster. Nach dem Download erscheint die Windows-Sicherheitsabfrage."
        }
        if (-not $isAdmin -and $env:SM_NO_ELEVATE -ne "1") {
            # Ohne Administratorrechte kann nichts installiert werden: erhoeht neu starten (nach dem Download, die Dateien bleiben liegen)
            $keepOnError = $true
        }

        # 7. Download und Pruefung der Teile
        $files = @($partNames)
        $i = 0
        foreach ($f in $files) {
            $i++
            $target = Join-Path $partDir $f
            Status "Teil $i von $($files.Count): $f"
            if (Test-Sum $sums $f $target) {
                Status "bereits vollstaendig$(if ($local) { ' (geprueft)' } else { ' geladen' })"
                continue
            }
            if ($local) { Fail "Pruefsumme von $f stimmt nicht (oder die Datei fehlt) in $localDir." }
            $keepOnError = $true   # halbe Downloads bleiben fuer die Wiederaufnahme liegen
            Receive-File "$base/$f" $target
            $keepOnError = $false
            if (-not (Test-Sum $sums $f $target)) {
                Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
                Fail "Pruefsumme von $f stimmt nicht. Datei geloescht; bitte erneut starten."
            }
        }
        Status "Alle $($files.Count) Dateien geprueft."
        $parts = @($files | ForEach-Object { Join-Path $partDir $_ })

        if (-not $isAdmin -and $env:SM_NO_ELEVATE -ne "1") {
            # Der Download ist fertig; jetzt die Abfrage (UAC) fuer die eigentliche Installation.
            $resolved = @{}
            foreach ($e in $o.GetEnumerator()) { $resolved[$e.Key] = $e.Value }
            $resolved["Version"] = $version; $resolved["Variant"] = $variant; $resolved["AcceptEula"] = $true
            if ($local) { $resolved["SourceDir"] = $localDir } else { $resolved["SourceDir"] = $workDir }
            Status "Starte die Installation mit Administratorrechten (die Windows-Sicherheitsabfrage erscheint) ..."
            if (Start-Elevated $resolved) {
                Status "Die Installation laeuft im neuen Fenster weiter."
                return
            }
            Fail "Ohne Administratorrechte kann nicht installiert werden. Erneut starten oeffnet die Abfrage ohne neuen Download."
        }
        $keepOnError = $true   # bei Fehlern in der Einrichtung bleiben die geprueften Teile fuer einen neuen Start liegen

        # 8. Installationsskript des Pakets vorab herausziehen (Portpruefung, Update-Vorbereitung laufen vor dem Entpacken)
        Initialize-Archive
        $preDir = Join-Path $workDir "pre"
        $preScript = Join-Path $preDir "install-native.ps1"
        if (-not [SmArchive]::ExtractOne($parts, "tools/install-native.ps1", $preScript)) { Fail "Das Paket enthaelt tools\install-native.ps1 nicht (unvollstaendiges Paket)." }

        # 9. Portpruefung (Neuinstallation immer; Update nur bei ausdruecklich uebergebenen Ports)
        $internal = [ordered]@{ PgPort = "-PostgresPort"; QdrantPort = "-QdrantPort"; QdrantGrpcPort = "-QdrantGrpcPort"; IngestionPort = "-IngestionPort"; VoicePort = "-VoicePort" }
        $internalValue = @{}
        foreach ($k in $internal.Keys) { if (Has $k) { $internalValue[$k] = "$($o[$k])".Trim() } }
        $movedKeys = @{ POSTGRES = "PgPort"; QDRANT_PORT = "QdrantPort"; QDRANT_GRPC_PORT = "QdrantGrpcPort"; INGESTION_WORKER_PORT = "IngestionPort"; VOICE_WORKER_PORT = "VoicePort" }
        $webList = if (Has "Port") { ("$($o['Port'])" -replace '[;\s]+', ',').Trim(",") } else { "" }
        $resolvedPort = ""
        $hwAgentOn = (-not $updating) -and (-not (Has "HwAgent") -or (ConvertTo-Bool $o["HwAgent"]))
        if ((-not $updating) -or $webList -or $internalValue.Count -gt 0) {
            $resultFile = Join-Path $workDir "ports.txt"
            for ($attempt = 1; $attempt -le 5; $attempt++) {
                Remove-Item -LiteralPath $resultFile -Force -ErrorAction SilentlyContinue
                $checkArgs = @("-Action", "CheckPorts", "-InstallDir", $installDir, "-DataDir", $dataDir, "-ResultFile", $resultFile)
                if ($webList) { $checkArgs += @("-Port", $webList) }
                foreach ($k in $internalValue.Keys) { $checkArgs += @($internal[$k], $internalValue[$k]) }
                if ((Flag "PortAuto") -or (Test-Interactive)) { $checkArgs += "-AutoPorts" }
                if (Flag "PortAuto") { $checkArgs += "-AutoWebPort" }
                if ($hwAgentOn) { $checkArgs += "-HardwareAgent" }
                if ($updating -and ($webList -or $internalValue.Count -gt 0)) { $checkArgs += "-CheckInstalled" }
                Status "Pruefe die Ports ..."
                $code = Invoke-Script $preScript $checkArgs
                $lines = if (Test-Path -LiteralPath $resultFile) { @(Get-Content -LiteralPath $resultFile) } else { @() }
                $chosen = ($lines | Where-Object { $_ -like "CHOSEN=*" } | Select-Object -First 1)
                $suggest = ($lines | Where-Object { $_ -like "SUGGEST=*" } | Select-Object -First 1)
                if ($code -eq 0) {
                    foreach ($line in ($lines | Where-Object { $_ -like "MOVED=*" })) {
                        $f = $line.Substring(6).Split(";")
                        if ($f.Count -ge 3 -and $movedKeys.ContainsKey($f[0])) { $internalValue[$movedKeys[$f[0]]] = $f[2].Trim() }
                    }
                    if ($chosen) { $resolvedPort = $chosen.Substring(7).Trim() }
                    break
                }
                $hint = if ($suggest) { "Port $($suggest.Substring(8).Trim()) ist frei (Vorschlag)." } else { "" }
                if ($hint) { Write-Host $hint }
                if (Test-Interactive) {
                    $answer = "$(Read-Host 'Anderer Web-Port (Enter bricht ab)')".Trim()
                    if ($answer -match '^\d{1,5}$') { $webList = $answer; continue }
                }
                Fail "Portkonflikt: die belegenden Programme beenden oder einen anderen Port waehlen (-Port <Liste>, -PortAuto) und erneut starten."
            }
            if ($code -ne 0) { Fail "Portpruefung nicht erfolgreich." }
        }
        if (-not $resolvedPort) {
            if ($webList) { $resolvedPort = $webList.Split(",")[0] }
            elseif ($updating) {
                $state = Join-Path $dataDir "install-state.json"
                try { $resolvedPort = "$((Get-Content -LiteralPath $state -Raw -Encoding UTF8 | ConvertFrom-Json).port)" } catch { }
            }
            if (-not $resolvedPort -or $resolvedPort -eq "0") { $resolvedPort = "5043" }
        }

        # Rueckfragen fuer die Neuinstallation im Terminal (nur was nicht schon als Option kam)
        if (-not $updating -and (Test-Interactive)) {
            if (-not (Has "Lan") -and -not (Has "LanBackend") -and -not (Has "LanChat") -and -not (Has "LanAdmin")) {
                $o["Lan"] = Read-YesNo "Zugriff aus dem lokalen Netzwerk erlauben (sonst nur auf diesem Rechner)?" $false
            }
            if (-not (Has "PublicHost") -and -not (Has "TlsMode")) {
                $name = "$(Read-Host 'HTTPS-Name fuer den Zugriff im Netzwerk, z. B. sm.firma.de (Enter = keiner)')".Trim()
                if ($name) {
                    $o["PublicHost"] = $name
                    $o["TlsMode"] = "internal"
                    $m = "$(Read-Host 'Zertifikat: internal (eigene CA, ohne Internet), acme-http, acme-dns [internal]')".Trim().ToLowerInvariant()
                    if ($m -in "acme-http", "acme-dns", "internal") { $o["TlsMode"] = $m }
                    if ($o["TlsMode"] -eq "acme-dns") {
                        if (-not (Has "DnsProvider")) { $o["DnsProvider"] = "$(Read-Host 'DNS-Anbieter (z. B. cloudflare, ionos)')".Trim() }
                        if (-not $env:SM_DNS_PROVIDER_TOKEN) { $env:SM_DNS_PROVIDER_TOKEN = Read-Secret "API-Schluessel des DNS-Anbieters" }
                    }
                }
            }
        }

        # 10. Update: Sicherung, Dienste stoppen, Vorversion sichern (mit dem neuen Skript, bevor Dateien ersetzt werden)
        if ($updating) {
            if (-not (Flag "FullBackup") -and -not (Has "FullBackup") -and (Test-Interactive)) { $o["FullBackup"] = Read-YesNo "Vor dem Update auch den Dokumentenspeicher sichern (dauert laenger, braucht Platz)?" $false }
            Status "Sicherung der Datenbank und Beenden der Dienste ..."
            $prep = @("-Action", "PrepareUpdate", "-InstallDir", $installDir, "-DataDir", $dataDir)
            if (Flag "FullBackup") { $prep += "-FullBackup" }
            $code = Invoke-Script $preScript $prep
            if ($code -ne 0) { Fail "Die Vorbereitung des Updates ist fehlgeschlagen (Details: $dataDir\logs\install.log). Die bestehende Installation wurde nicht veraendert." }
        }

        # 11. Entpacken: Zielordner erneut pruefen, sperren (eigener Ordner ausserhalb von Program Files) und markieren, dann entpacken
        $installDirExisted = Test-InstallTarget $installDir
        New-Item -ItemType Directory -Force $installDir | Out-Null
        Protect-InstallDir $installDir $installDirExisted
        [IO.File]::WriteAllText((Join-Path $installDir $installMarkerName), "SovereignMind-Installationsordner (angelegt von install.ps1). tools\uninstall.ps1 loescht diesen Ordner nur, wenn diese Datei vorhanden ist.`r`n", (New-Object Text.UTF8Encoding($false)))
        Status "Entpacke nach $installDir ..."
        $progress = [SmProgress] { param($done, $total, $name)
            if ($total -gt 0) { Write-Host ("    {0} von {1} MiB ({2} %)" -f [int64]($done / 1MB), [int64]($total / 1MB), [int]($done * 100 / $total)) }
        }
        $count = [SmArchive]::Extract($parts, $installDir, $progress)
        $bytes = [SmArchive]::LastBytes
        Status "$count Dateien entpackt."
        $packageVariant = $variant
        $variantFile = Join-Path $installDir "VARIANT"
        if (Test-Path -LiteralPath $variantFile) { $packageVariant = ("$(Get-Content -LiteralPath $variantFile -TotalCount 1)").Trim().ToLowerInvariant() }

        # 12. Einrichtung der Dienste (install-native.ps1 des Pakets)
        $native = Join-Path $installDir "tools\install-native.ps1"
        $a = @("-Action", "Install", "-InstallDir", $installDir, "-DataDir", $dataDir)
        if (-not $updating) {
            $a += @("-Port", $resolvedPort)
            if ($hwAgentOn) {
                $a += "-HardwareAgent"
                if (-not (Has "PawnIO") -or (ConvertTo-Bool $o["PawnIO"])) { $a += "-PawnIO" }
            }
        }
        elseif (Has "Port") { $a += @("-Port", $resolvedPort) }
        # LAN: standardmaessig nur localhost; ein Update behaelt die gespeicherte Wahl, solange nichts ausdruecklich gesetzt ist
        if (Flag "Lan") { $a += "-Lan" }
        elseif ((Has "Lan") -or -not $updating) { $a += @("-LanMode", "off") }
        if (Has "LanAddress") { $a += @("-LanAddress", "$($o['LanAddress'])") }
        if (Has "LanBackend") { $a += @("-LanBackend", (OnOff $o["LanBackend"])) }
        if (Has "LanChat") { $a += @("-LanChat", (OnOff $o["LanChat"])) }
        if (Has "LanAdmin") { $a += @("-LanAdmin", (OnOff $o["LanAdmin"])) }
        if (Has "Llm") { $a += @("-Llm", $(if (ConvertTo-Bool $o["Llm"]) { "1" } else { "0" })) }
        elseif (-not $updating) { $a += @("-Llm", "1") }
        if (Has "Frontend") { $a += @("-FrontendMode", (OnOff $o["Frontend"])) }
        elseif (-not $updating) { $a += @("-FrontendMode", "on") }
        foreach ($k in $internal.Keys) { if ($internalValue.ContainsKey($k)) { $a += @($internal[$k], $internalValue[$k]) } }
        if (Has "Config") { $a += @("-ConfigFile", "$($o['Config'])") }
        if (Flag "SkipPython") { $a += "-SkipPython" }
        if (Has "Cors") { $a += @("-Cors", "$($o['Cors'])") }
        $tlsMode = if (Has "TlsMode") { "$($o['TlsMode'])".ToLowerInvariant() } else { "" }
        if ($tlsMode -in "off", "none") { $tlsMode = "off" }
        if ($tlsMode -ne "off") {
            if (Has "PublicHost") {
                $a += @("-PublicHost", "$($o['PublicHost'])")
                if (Has "AdminHost") { $a += @("-AdminHost", "$($o['AdminHost'])") }
                if ($tlsMode) { $a += @("-TlsMode", $tlsMode) }
                if (Has "DnsProvider") { $a += @("-DnsProvider", "$($o['DnsProvider'])") }
            }
            elseif (-not $updating -and (-not $tlsMode -or $tlsMode -eq "wildcard")) {
                # Mitgeliefertes Zertifikat: ohne -PublicHost setzt das Skript chat./admin. aus dem Zertifikat. Fehlt es im Paket, bleibt HTTPS aus.
                if ((Test-Path -LiteralPath (Join-Path $installDir "tls\wildcard.crt")) -and (Test-Path -LiteralPath (Join-Path $installDir "tls\wildcard.key"))) { $a += @("-TlsMode", "wildcard") }
                else { Status "HTTPS: kein Zertifikat im Paket, HTTPS bleibt aus. Nachtraeglich: tools\install-native.ps1 -Action SetHttps." }
            }
        }
        Status "Richte die Dienste ein (Datenbank, Python-Umgebungen) - das dauert einige Minuten ..."
        $code = Invoke-Script $native $a
        if ($code -ne 0) {
            Write-Host "Die Einrichtung der Dienste ist fehlgeschlagen (Code $code). Details: $dataDir\logs\install.log" -ForegroundColor Red
            Write-Host "Nach Behebung der Ursache kann dieses Skript erneut ausgefuehrt werden (Reparatur, Daten bleiben erhalten)."
            # Skript-Code + 10: 11 allgemein, 12 Backend startet nicht, 13 Update zurueckgerollt (wie beim frueheren Setup)
            $global:LASTEXITCODE = $code + 10
            return
        }

        # 13. Eintrag unter "Apps & Features", Startmenue
        Register-Installation $installDir $version $dataDir $resolvedPort $bytes
        Status "Eintrag unter 'Apps & Features' und Startmenue angelegt."

        # 14. Erstregistrierung ohne Weboberflaeche
        if (Has "LicenseEmail") {
            $env:SM_LICENSE_TOKEN = "$($o['LicenseToken'])"; $env:SM_ADMIN_PASSWORD = "$($o['AdminPassword'])"
            try {
                $reg = @("-Action", "RegisterTenant", "-InstallDir", $installDir, "-DataDir", $dataDir, "-LicenseEmail", "$($o['LicenseEmail'])")
                if (Has "TenantName") { $reg += @("-TenantName", "$($o['TenantName'])") }
                $code = Invoke-Script $native $reg
                if ($code -ne 0) {
                    Write-Warning "Erstregistrierung fehlgeschlagen (Code $code), siehe $dataDir\logs\register-result.txt."
                    if (Flag "Strict") { $global:LASTEXITCODE = 16; return }
                }
            }
            finally { Remove-Item Env:\SM_LICENSE_TOKEN, Env:\SM_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
        }

        # 15. KI-Modelle (nur Variante minimal)
        if ($packageVariant -eq "minimal") {
            $python = Join-Path $installDir "python\python.exe"
            if ((Has "Models") -and "$($o['Models'])".ToLowerInvariant() -eq "skip") {
                Status "Modelle: uebersprungen (-Models skip). Der Admin laedt sie spaeter im Admin-Bereich."
                if (Test-Path -LiteralPath $python) {
                    & $python (Join-Path $installDir "tools\load-models.py") --install-dir $installDir --data-dir $dataDir --mark skipped --message "Modelle wurden bei der Installation uebersprungen (-Models skip)." | Out-Null
                }
            }
            else {
                $groups = if (Flag "SkipPython") { "gguf" } else { "gguf,workers" }
                $outcome = Invoke-ModelLoad $installDir $dataDir $groups
                [void](Invoke-Script $native @("-Action", "GrantModels", "-InstallDir", $installDir, "-DataDir", $dataDir))
                if ($outcome -ne "done") {
                    $hint = switch ($outcome) {
                        "cancelled" { "Das Laden der KI-Modelle wurde abgebrochen." }
                        "crashed" { "Das Laden der KI-Modelle wurde unerwartet beendet (Protokoll: $dataDir\logs\model-load.log)." }
                        default { "Nicht alle KI-Modelle konnten geladen werden (Internet, Proxy oder Firewall? Freigabe fuer huggingface.co)." }
                    }
                    Write-Warning $hint
                    Write-Host "Die Installation ist trotzdem fertig. Bis die Modelle geladen sind, kann SovereignMind keine Fragen beantworten: im Admin-Bereich erscheint ein Hinweis mit der Schaltflaeche 'Jetzt laden' (oder unter Einstellungen > Lokale Modelle)."
                    if ((Flag "Strict") -and $outcome -ne "skipped") { $global:LASTEXITCODE = 15; return }
                }
            }
        }

        # 16. Recovery-Kit
        $kitConfirmed = $updating -and (Test-Path -LiteralPath (Join-Path $dataDir "recovery-kit.json"))
        if (-not $kitConfirmed) {
            $folder = if (Has "RecoveryKit") { "$($o['RecoveryKit'])" } else { "" }
            $passphrase = if (Has "RecoveryPassphrase") { "$($o['RecoveryPassphrase'])" } else { "" }
            if (-not $folder -and (Test-Interactive)) {
                Write-Host ""
                Write-Host "WICHTIG: Recovery-Kit sichern. Ohne die Schluessel (Datenbank-Passwort, Zertifikat, JWT) sind Connector-Geheimnisse und Paketschluessel nicht wiederherstellbar."
                if (Read-YesNo "Recovery-Kit jetzt in einen Ordner exportieren (z. B. auf einen USB-Stick)?" $false) {
                    $folder = "$(Read-Host 'Zielordner')".Trim()
                    while ($folder -and $passphrase.Length -lt 12) {
                        $passphrase = Read-Secret "Passphrase (mindestens 12 Zeichen, nicht wiederherstellbar)"
                        if ($passphrase.Length -lt 12) { Write-Host "Zu kurz." }
                    }
                }
            }
            if ($folder) {
                if ($passphrase.Length -lt 12) { Write-Warning "Recovery-Kit nicht exportiert: Passphrase fehlt oder ist kuerzer als 12 Zeichen (-RecoveryPassphrase oder SM_RECOVERY_PASSPHRASE)." }
                else {
                    $message = ""
                    if (Export-RecoveryKit $installDir $folder $passphrase ([ref]$message)) { Status "Recovery-Kit exportiert: $message" }
                    else { Write-Warning "Recovery-Kit-Export fehlgeschlagen: $message (die Installation bleibt gueltig; der Admin-Bereich erinnert daran)." }
                }
            }
            else { Write-Host "Hinweis: Das Recovery-Kit ist noch nicht gesichert. Der Admin-Bereich erinnert daran; Export: tools\recovery-kit.ps1 export --out <Ordner>." }
        }

        $keepOnError = $false
        $global:LASTEXITCODE = 0
        Status "Fertig. SovereignMind $version ist eingerichtet: http://localhost:$resolvedPort"
        Write-Host "Deinstallation: Einstellungen > Apps > SovereignMind oder $installDir\tools\uninstall.ps1"
    }
    catch [System.InvalidOperationException] {
        Write-Host "FEHLER: $($_.Exception.Message)" -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
    catch {
        Write-Host "FEHLER: $($_.Exception.Message)" -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
    finally {
        if ($workCreated) {
            if ($env:SM_KEEP -eq "1") { Status "Arbeitsordner bleibt erhalten: $workDir" }
            elseif ($keepOnError) { Status "Geladene Dateien bleiben fuer einen neuen Start in $workDir." }
            else { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
}

# Erst die letzten Zeilen fuehren aus: ein unvollstaendig geladenes Skript tut nichts.
# Die alte Schreibweise des Setups ("install.ps1 /VERYSILENT /PORT=8443") geht als Textliste an -SetupArgs, PowerShell-Parameter ("-Port 8443") unveraendert.
$smArgs = @($args)
if ($smArgs.Count -gt 0 -and @($smArgs | Where-Object { "$_" -match '^/[A-Za-z]' }).Count -gt 0) {
    $smText = ($smArgs | ForEach-Object { "$_" -replace '^(/[A-Za-z]+=)(.*\s.*)$', '$1"$2"' }) -join " "
    Install-SovereignMind -SetupArgs $smText
}
else { Install-SovereignMind @smArgs }
