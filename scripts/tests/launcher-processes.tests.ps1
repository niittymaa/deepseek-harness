$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../launcher-processes.ps1')
$root = 'C:\Work with spaces\Harness'
$created = [datetime]'2026-10-28T10:00:00Z'
function New-FixtureProcess($id, $parent, $command, $name = 'electron.exe') {
    [pscustomobject]@{ ProcessId = $id; ParentProcessId = $parent; Name = $name; CommandLine = $command; CreationDate = $created; ExecutablePath = 'C:\Electron\electron.exe' }
}
$processes = @(
    (New-FixtureProcess 10 1 '"C:\Electron\electron.exe" --inspect=127.0.0.1:9229 "C:\Work with spaces\Harness\apps\desktop"'),
    (New-FixtureProcess 11 10 '"C:\Electron\electron.exe" --type=renderer'),
    (New-FixtureProcess 12 11 'node worker.js' 'node.exe'),
    (New-FixtureProcess 20 1 '"C:\Electron\electron.exe" "C:\Other App"'),
    (New-FixtureProcess 21 20 '"C:\Electron\electron.exe" --type=renderer'),
    (New-FixtureProcess 30 1 '"C:\Electron\electron.exe" "C:\Work with spaces\Harness\apps\desktop-copy"'),
    (New-FixtureProcess 31 1 'electron.exe "C:\Other App" "C:\Work with spaces\Harness\apps\desktop"'),
    (New-FixtureProcess 32 1 'electron.exe --user-data-dir "C:\Work with spaces\Harness\apps\desktop" "C:\Other App"'),
    (New-FixtureProcess 40 1 '"C:\Other App\DeepSeek Harness.exe"' 'DeepSeek Harness.exe')
)
$olderChild = New-FixtureProcess 60 10 'electron.exe --type=renderer'
$olderChild.CreationDate = $created.AddSeconds(-1)
$processes += $olderChild
$selected = @(Get-HarnessDesktopProcess -RepositoryRoot $root -Processes $processes)
if (($selected.ProcessId -join ',') -ne '12,11,10') { throw 'Must select only the checkout desktop tree, children first.' }
if (@(Get-HarnessDesktopProcess -RepositoryRoot $root -Processes @()).Count -ne 0) { throw 'Empty inventory must select nothing.' }
$mainEntry = New-FixtureProcess 50 1 'electron.exe "c:/work with spaces/harness/apps/desktop/lib/main.js"'
if (@(Get-HarnessDesktopProcess -RepositoryRoot $root -Processes @($mainEntry)).Count -ne 1) { throw 'Must recognize the exact main entry across case and separators.' }

$script:currentProcesses = @{}
foreach ($candidate in $processes) { $script:currentProcesses[[int]$candidate.ProcessId] = $candidate | Select-Object * }
$script:stopped = [System.Collections.Generic.List[int]]::new()
function Get-CimInstance {
    [CmdletBinding()]param([string]$ClassName, [string]$Filter)
    if (-not $Filter) { return $processes }
    $id = [int]($Filter -replace '^ProcessId = ', '')
    return $script:currentProcesses[$id]
}
function Stop-Process {
    [CmdletBinding()]param([int]$Id, [switch]$Force)
    $script:stopped.Add($Id)
}
Stop-HarnessDesktopProcesses -RepositoryRoot $root
if (($script:stopped -join ',') -ne '12,11,10') { throw 'Cleanup must not stop unrelated applications.' }
$script:stopped.Clear()
$script:currentProcesses[10].CreationDate = $created.AddSeconds(1)
$script:currentProcesses.Remove(11)
$script:currentProcesses[12].ExecutablePath = 'C:\Other\node.exe'
Stop-HarnessDesktopProcesses -RepositoryRoot $root
if ($script:stopped.Count -ne 0) { throw 'Cleanup must skip reused, exited, or replaced processes.' }
Write-Host 'PASS: checkout ownership, descendants, unrelated apps, path matching, process exit and PID reuse.'
