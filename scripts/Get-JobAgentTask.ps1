[CmdletBinding()]
param([string]$TaskName = 'JobAgent-DiscoveryReview', [string]$ProjectRoot = '')
$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
$task | Select-Object TaskName, State, Description, Actions, Triggers, Principal, Settings | Format-List
$info | Select-Object LastRunTime, LastTaskResult, NextRunTime, NumberOfMissedRuns | Format-List
$recordPath = Join-Path $ProjectRoot 'data\scheduler\latest-run.json'
if (Test-Path -LiteralPath $recordPath) {
 $record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
 Write-Output 'Latest completed/started launcher run (individual skips are in launcher.jsonl):'
 $record | Select-Object runId, startedAt, finishedAt, outcome, exitCode, error | Format-List
 $record.stages | Select-Object command, outcome, exitCode, stdout, stderr | Format-Table -AutoSize
}
