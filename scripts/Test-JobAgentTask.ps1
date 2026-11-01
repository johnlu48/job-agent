[CmdletBinding()]
param(
 [string]$TaskName = 'JobAgent-DiscoveryReview',
 [switch]$Scheduled,
 [string]$ProjectRoot = ''
)
$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
if ($Scheduled) {
 $task = Get-ScheduledTask -TaskName $TaskName
 $launcher = Join-Path (Resolve-Path -LiteralPath $ProjectRoot).Path 'scripts\Invoke-JobAgent.ps1'
 if (@($task.Actions).Count -ne 1 -or -not $task.Actions[0].Arguments.Contains('"' + $launcher + '"')) { throw 'Registered action does not match this project launcher; inspect the task before starting it.' }
 Start-ScheduledTask -TaskName $TaskName
 Write-Output 'Started the registered task. Use Get-JobAgentTask.ps1 and data\scheduler\logs to inspect the result.'
} else {
 $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 & $powerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Invoke-JobAgent.ps1') -ProjectRoot $ProjectRoot
 exit $LASTEXITCODE
}
