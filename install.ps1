# SovereignMind: Installation der minimalen Variante unter Windows per Einzeiler.
#   irm https://sovereignmind-deutschland.github.io/sovereignmind-website/install.ps1 | iex
# Vorab lesen: irm https://sovereignmind-deutschland.github.io/sovereignmind-website/install.ps1   (ohne "| iex")
# Lädt SovereignMind-Setup-Minimal-<V>.exe und die .bin-Teile aus dem GitHub-Release, prüft sie und startet das Setup.
#
# Umgebungsvariablen:
#   SM_VERSION       Version (Tag ohne "v"); Standard: neuestes Release
#   SM_DOWNLOAD_DIR  Arbeitsordner (Standard $env:TEMP\SovereignMind-Install)
#   SM_KEEP=1        Arbeitsordner nicht löschen
#   SM_SETUP_ARGS    Optionen für das Setup, z. B. "/PORT=8443 /FRONTEND=off"
#   SM_DRY_RUN=1     nur prüfen und anzeigen
#   SM_API_URL, SM_BASE_URL, SM_FREE_KB, SM_NO_ELEVATE=1   (nur für Tests)
# Die EULA zeigt das Setup; dieses Skript stimmt nie zu.
# Ergebnis: $global:LASTEXITCODE (0 Erfolg, 1 Fehler); das Skript beendet die Sitzung nie.

function Install-SovereignMind {
    [CmdletBinding()]
    param()

    $ErrorActionPreference = "Stop"
    $repo = "sovereignmind-deutschland/sovereignmind-installer"
    $apiUrl = if ($env:SM_API_URL) { $env:SM_API_URL } else { "https://api.github.com/repos/$repo/releases/latest" }
    $baseUrl = if ($env:SM_BASE_URL) { $env:SM_BASE_URL } else { "https://github.com/$repo/releases/download" }
    $workDir = if ($env:SM_DOWNLOAD_DIR) { $env:SM_DOWNLOAD_DIR } else { Join-Path $env:TEMP "SovereignMind-Install" }
    # Platzbedarf im Arbeitsordner in KiB: Download ca. 3 GB, Puffer für das Setup
    $needKb = 4 * 1024 * 1024
    $keepOnError = $false
    $workCreated = $false
    $global:LASTEXITCODE = 0

    function Status($text) { Write-Host ">>> $text" }
    function Fail($text) { throw [System.InvalidOperationException]::new($text) }

    function Get-Curl {
        $c = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) { $c.Source } else { $null }
    }

    # Download mit Wiederaufnahme: curl.exe (ab Windows 10 1803), Rückfall BITS
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
            Fail "Weder curl.exe noch BITS vorhanden. Windows 10 ab Version 1803 wird benötigt."
        }
    }

    function Test-Sum([hashtable]$sums, [string]$name, [string]$file) {
        if (-not $sums.ContainsKey($name) -or -not (Test-Path -LiteralPath $file)) { return $false }
        return ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sums[$name])
    }

    try {
        # 1. Prüfungen
        if ($PSVersionTable.PSVersion.Major -lt 5) { Fail "PowerShell 5.1 oder 7 wird benötigt (gefunden: $($PSVersionTable.PSVersion))." }
        if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) { Fail "Dieses Skript läuft nur unter Windows (Linux: install.sh)." }
        if (-not [Environment]::Is64BitOperatingSystem) { Fail "Nur 64-Bit-Windows wird unterstützt." }
        if ([Environment]::OSVersion.Version.Build -lt 17763) { Fail "Windows 10 (1809) oder neuer bzw. Server 2019 oder neuer wird benötigt (Build $([Environment]::OSVersion.Version.Build))." }
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
        if (-not (Get-Curl) -and -not (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue)) { Fail "Weder curl.exe noch BITS vorhanden." }

        # 2. Version
        if ($env:SM_VERSION) {
            $version = $env:SM_VERSION.TrimStart("v")
        }
        else {
            Status "Ermittle die neueste Version ..."
            $curl = Get-Curl
            if (-not $curl) { Fail "curl.exe fehlt; Version mit SM_VERSION angeben, z. B. `$env:SM_VERSION='2026.11.12.1500'." }
            $json = & $curl --fail --silent --show-error --location -H "User-Agent: sovereignmind-install" $apiUrl 2>&1
            if ($LASTEXITCODE -ne 0) {
                $msg = ($json | Out-String).Trim()
                if ($msg -match "40[3]|429") { Fail "GitHub-API-Limit erreicht. Version angeben, z. B. `$env:SM_VERSION='2026.11.12.1500' (siehe Download-Seite)." }
                Fail "Release nicht abrufbar: $msg"
            }
            $tag = $null
            try { $tag = ((($json | Out-String) | ConvertFrom-Json).tag_name) } catch { }
            if (-not $tag) { Fail "Kein 'tag_name' in der Antwort der Release-API." }
            $version = "$tag".TrimStart("v")
        }
        if ($version -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]*$') { Fail "Ungültige Version '$version'." }
        $tagName = "v$version"
        $base = "$baseUrl/$tagName"
        Status "Version $version"

        # Platz (der Ordner wird erst nach dem Trockenlauf angelegt)
        if ($env:SM_FREE_KB) {
            $freeKb = [int64]$env:SM_FREE_KB
        }
        else {
            $probe = $workDir
            while ($probe -and -not (Test-Path -LiteralPath $probe)) { $probe = Split-Path -Parent $probe }
            $root = if ($probe) { [IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $probe).Path) } else { [IO.Path]::GetPathRoot($env:TEMP) }
            $drive = New-Object System.IO.DriveInfo($root)
            $freeKb = [int64]($drive.AvailableFreeSpace / 1024)
        }
        if ($freeKb -lt $needKb) {
            Fail ("Zu wenig Platz in {0}: frei {1} MiB, nötig ca. {2} MiB. Anderen Ordner mit `$env:SM_DOWNLOAD_DIR wählen." -f $workDir, [int64]($freeKb / 1024), [int64]($needKb / 1024))
        }
        Write-Warning "Danach installiert das Setup die Anwendung und lädt ca. 11 GB Modelle; auf dem Systemlaufwerk ebenfalls genug Platz einplanen."

        $setupArgs = if ($env:SM_SETUP_ARGS) { $env:SM_SETUP_ARGS } else { "" }
        if ($env:SM_DRY_RUN -eq "1") {
            Status "Trockenlauf: würde $base/SHA256SUMS.txt, SovereignMind-Setup-Minimal-$version.exe und die .bin-Teile nach $workDir laden und das Setup starten ($setupArgs). Nichts wurde geändert."
            return
        }

        # 3. Download
        New-Item -ItemType Directory -Force -Path $workDir | Out-Null
        $workCreated = $true
        $sumsFile = Join-Path $workDir "SHA256SUMS.txt"
        Status "Lade Prüfsummen ..."
        Remove-Item -LiteralPath $sumsFile -Force -ErrorAction SilentlyContinue
        Receive-File "$base/SHA256SUMS.txt" $sumsFile

        # 4. Prüfsummen einlesen: nur die Dateien dieses Setups
        $exeName = "SovereignMind-Setup-Minimal-$version.exe"
        $sums = @{}
        foreach ($line in (Get-Content -LiteralPath $sumsFile)) {
            if ($line -match '^([0-9a-fA-F]{64})[ \t]+\*?(.+?)\s*$') { $sums[$Matches[2]] = $Matches[1].ToLowerInvariant() }
        }
        if (-not $sums.ContainsKey($exeName)) { Fail "Im Release $tagName gibt es kein $exeName." }
        $binPattern = '^' + [regex]::Escape("SovereignMind-Setup-Minimal-$version-") + '(\d+)\.bin$'
        $bins = @($sums.Keys | Where-Object { $_ -match $binPattern } | Sort-Object { [int]([regex]::Match($_, $binPattern).Groups[1].Value) })
        $files = @($exeName) + $bins
        # Lückenlose Nummerierung 1..N (fehlt ein Teil, bricht das Setup mit unklarer Meldung ab)
        for ($n = 0; $n -lt $bins.Count; $n++) {
            if ([int]([regex]::Match($bins[$n], $binPattern).Groups[1].Value) -ne ($n + 1)) { Fail "Im Release $tagName fehlt Teil $($n + 1) der .bin-Dateien." }
        }

        $i = 0
        foreach ($f in $files) {
            $i++
            $target = Join-Path $workDir $f
            Status "Teil $i von $($files.Count): $f"
            if (Test-Sum $sums $f $target) {
                Status "bereits vollständig geladen"
                continue
            }
            $keepOnError = $true   # halbe Downloads bleiben für die Wiederaufnahme liegen
            Receive-File "$base/$f" $target
            $keepOnError = $false
            if (-not (Test-Sum $sums $f $target)) {
                Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
                Fail "Prüfsumme von $f stimmt nicht. Datei gelöscht; bitte erneut starten."
            }
        }
        Status "Alle $($files.Count) Dateien geprüft."

        # 5. Setup starten (UAC-Abfrage); die EULA zeigt das Setup
        $exe = Join-Path $workDir $exeName
        Status "Starte das Setup (die Windows-Sicherheitsabfrage erscheint) ..."
        $start = @{ FilePath = $exe; Wait = $true; PassThru = $true }
        if ($setupArgs.Trim()) { $start.ArgumentList = $setupArgs }
        if ($env:SM_NO_ELEVATE -ne "1") { $start.Verb = "RunAs" }
        try { $p = Start-Process @start } catch { Fail "Das Setup wurde nicht gestartet (Abfrage abgelehnt?): $($_.Exception.Message)" }
        if ($p.ExitCode -ne 0) { Fail "Das Setup endete mit Exit-Code $($p.ExitCode)." }
        Status "Fertig. Das Setup hat die Installation abgeschlossen."
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
            elseif ($keepOnError) { Status "Teilweise geladene Dateien bleiben für die Wiederaufnahme in $workDir." }
            else { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
}

# Erst die letzte Zeile führt aus: ein unvollständig geladenes Skript tut nichts.
Install-SovereignMind
