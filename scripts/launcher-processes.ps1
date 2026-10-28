# Select desktop process trees belonging to this repository checkout.
function Get-HarnessDesktopProcess {
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Processes
    )
    $desktopRoot = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'apps/desktop')).TrimEnd('\', '/')
    $mainFile = Join-Path $desktopRoot 'lib/main.js'
    $owned = @{}
    foreach ($candidate in $Processes) {
        if ($candidate.Name -notmatch '^electron(?:\.exe)?$' -or -not $candidate.CommandLine) { continue }
        $arguments = [regex]::Matches($candidate.CommandLine, '"([^"\r\n]*)"|([^\s"]+)')
        foreach ($argument in @($arguments | Select-Object -Skip 1)) {
            $value = if ($argument.Groups[1].Success) { $argument.Groups[1].Value } else { $argument.Groups[2].Value }
            if ($value.StartsWith('--') -and $value.Contains('=')) {
                if ($value.StartsWith('--type=')) { break }
                continue
            }
            $value = $value.Replace('/', '\').TrimEnd('\')
            if ($value -ieq $desktopRoot.Replace('/', '\') -or $value -ieq $mainFile.Replace('/', '\')) {
                $owned[[int]$candidate.ProcessId] = [pscustomobject]@{ Process = $candidate; Depth = 0 }
            }
            break
        }
    }
    do {
        $added = $false
        foreach ($candidate in $Processes) {
            $processId = [int]$candidate.ProcessId
            $parentId = [int]$candidate.ParentProcessId
            if (-not $owned.ContainsKey($processId) -and $owned.ContainsKey($parentId)) {
                $parent = $owned[$parentId].Process
                if ($candidate.CreationDate -and $parent.CreationDate -and $candidate.CreationDate -lt $parent.CreationDate) { continue }
                $owned[$processId] = [pscustomobject]@{ Process = $candidate; Depth = $owned[$parentId].Depth + 1 }
                $added = $true
            }
        }
    } while ($added)
    $owned.Values | Sort-Object Depth -Descending | ForEach-Object { $_.Process }
}

# Recheck process identity before stopping a process selected from the snapshot.
function Stop-HarnessDesktopProcesses {
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    foreach ($candidate in @(Get-HarnessDesktopProcess -RepositoryRoot $RepositoryRoot -Processes $snapshot)) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.ProcessId)" -ErrorAction SilentlyContinue
        if ($null -eq $current -or $null -eq $candidate.CreationDate -or $null -eq $current.CreationDate) { continue }
        if ($current.CreationDate -ne $candidate.CreationDate -or $current.ExecutablePath -ine $candidate.ExecutablePath) { continue }
        Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop
    }
}
