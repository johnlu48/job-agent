[CmdletBinding()]
param(
 [string]$ProjectRoot = '',
 [string]$NodePath = 'node.exe'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$exitCode = 0
$hadWarnings = $false
$runRecord = $null
$lockStream = $null
$previousDirectory = Get-Location
try {
 $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
 Set-Location -LiteralPath $ProjectRoot
 $schedulerDirectory = Join-Path $ProjectRoot 'data\scheduler'
 $logDirectory = Join-Path $schedulerDirectory 'logs'
 [System.IO.Directory]::CreateDirectory($logDirectory) | Out-Null
 $logPath = Join-Path $logDirectory 'launcher.jsonl'
 function Write-LauncherLog([string]$Event, [string]$Detail) {
  $entry = @{ at = [DateTime]::UtcNow.ToString('o'); event = $Event; detail = $Detail; pid = $PID }
  $line = ($entry | ConvertTo-Json -Compress)
  [System.IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine)
  Write-Output $line
 }
 function Write-RunRecord {
  $path = Join-Path $schedulerDirectory 'latest-run.json'
  [System.IO.File]::WriteAllText(($path + '.tmp'), ($runRecord | ConvertTo-Json -Depth 20))
  if (Test-Path -LiteralPath $path) { [System.IO.File]::Replace(($path + '.tmp'), $path, ($path + '.previous')) }
  else { [System.IO.File]::Move(($path + '.tmp'), $path) }
 }
 try {
  $lockStream = [System.IO.File]::Open((Join-Path $schedulerDirectory 'launcher.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
 } catch [System.IO.IOException] {
  if (($_.Exception.HResult -band 0xffff) -ne 32) { throw }
  Write-LauncherLog 'skipped_duplicate' 'Another launcher holds the exclusive project lock.'
  exit 0
 }
 $NodePath = (Get-Command $NodePath -CommandType Application -ErrorAction Stop).Source
 $config = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'config\scheduler.json') | ConvertFrom-Json
 if ($config.dailyRunLimit -isnot [int] -or $config.dailyRunLimit -lt 0 -or $config.dailyRunLimit -gt 10) { throw 'dailyRunLimit must be an integer from 0 through 10 (0 disables the daily run limit).' }
 if ($config.commandTimeoutSeconds -isnot [int] -or $config.commandTimeoutSeconds -lt 1 -or $config.commandTimeoutSeconds -gt 1800) { throw 'commandTimeoutSeconds must be an integer from 1 through 1800.' }
 $workflow = @($config.workflow)
 if ($workflow.Count -eq 0) { throw 'workflow must contain discover and/or review.' }
 foreach ($command in $workflow) {
  if ($command -isnot [string] -or $command -notin @('discover', 'review')) { throw 'Only discover and review are permitted in the login workflow. Submissions are disabled.' }
 }
 # Remove live-mode flags inherited from the interactive environment.
 Remove-Item Env:JOB_AGENT_ENABLE_SUBMISSION -ErrorAction SilentlyContinue
 $guardScript = Join-Path $PSScriptRoot 'scheduler-status.mjs'
 $guardOutput = & $NodePath --no-warnings $guardScript $ProjectRoot
 if ($LASTEXITCODE -ne 0) { throw 'Could not read the submission guard; refusing to start.' }
 $guard = ($guardOutput -join [Environment]::NewLine) | ConvertFrom-Json
 if ($guard.submittedToday) { Write-LauncherLog 'skipped_submitted_today' ('An application is already confirmed submitted on ' + $guard.today); exit 0 }
 $statePath = Join-Path $schedulerDirectory 'state.json'
 $state = @{ day = $guard.today; runs = 0 }
 if (Test-Path -LiteralPath $statePath) {
  $saved = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
  if ($saved.runs -isnot [int] -or $saved.runs -lt 0 -or $saved.day -isnot [string] -or $saved.day -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'Invalid scheduler run state; refusing to reset the limit.' }
  if ($saved.day -eq $guard.today) { $state.runs = $saved.runs }
 }
 if ($config.dailyRunLimit -gt 0 -and $state.runs -ge $config.dailyRunLimit) { Write-LauncherLog 'skipped_daily_limit' ('Daily run limit reached for ' + $guard.today); exit 0 }
 # Count the run before starting. Failures and interrupted runs consume a slot.
 $state.runs++
 $temporaryState = $statePath + '.tmp'
 [System.IO.File]::WriteAllText($temporaryState, ($state | ConvertTo-Json))
 if (Test-Path -LiteralPath $statePath) { [System.IO.File]::Replace($temporaryState, $statePath, ($statePath + '.previous')) }
 else { [System.IO.File]::Move($temporaryState, $statePath) }
 $runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + $PID
 $runRecord = [ordered]@{ runId = $runId; startedAt = [DateTime]::UtcNow.ToString('o'); finishedAt = $null; outcome = 'running'; exitCode = $null; stages = @(); error = '' }
 Write-RunRecord
 Write-LauncherLog 'started' ('Discovery/review only. Working directory: ' + $ProjectRoot)
 foreach ($command in $workflow) {
  # Recheck before each stage so a concurrent manual submission stops later stages.
  $guardOutput = & $NodePath --no-warnings $guardScript $ProjectRoot
  if ($LASTEXITCODE -ne 0) { throw 'Submission guard failed during workflow.' }
  $guard = ($guardOutput -join [Environment]::NewLine) | ConvertFrom-Json
  if ($guard.submittedToday) { Write-LauncherLog 'skipped_submitted_today' 'Stopping remaining stages after a confirmed submission.'; break }
  $stdoutPath = Join-Path $logDirectory ($runId + '-' + $command + '.stdout.log')
  $stderrPath = Join-Path $logDirectory ($runId + '-' + $command + '.stderr.log')
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $NodePath
  $startInfo.Arguments = '"' + (Join-Path $ProjectRoot 'src\cli.ts') + '" ' + $command
  $startInfo.WorkingDirectory = $ProjectRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
   if (-not $process.Start()) { throw 'Could not start the CLI.' }
   $stdout = $process.StandardOutput.ReadToEndAsync()
   $stderr = $process.StandardError.ReadToEndAsync()
   $timedOut = -not $process.WaitForExit($config.commandTimeoutSeconds * 1000)
   if ($timedOut) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
    if (-not $process.WaitForExit(5000)) { throw ('CLI timed out and process cleanup failed: ' + $command) }
   }
   $stdoutText = $stdout.GetAwaiter().GetResult()
   [System.IO.File]::WriteAllText($stdoutPath, $stdoutText)
   [System.IO.File]::WriteAllText($stderrPath, $stderr.GetAwaiter().GetResult())
   if ($timedOut) { throw ('CLI timed out: ' + $command + '; stdout=' + $stdoutPath + '; stderr=' + $stderrPath) }
   $summary = $null
   if ($command -eq 'discover') {
    $summaryLines = @($stdoutText -split '\r?\n' | Where-Object { $_.StartsWith('DISCOVERY_SUMMARY ') })
    if ($summaryLines.Count -gt 0) { $summary = $summaryLines[-1].Substring(18) | ConvertFrom-Json }
   }
   $outcome = 'success'
   if ($command -eq 'discover' -and $process.ExitCode -eq 2 -and $null -ne $summary -and $summary.status -eq 'partial_success' -and $summary.exitCode -eq 2) {
    $outcome = 'partial_success'
    $hadWarnings = $true
    Write-LauncherLog 'discovery_partial_success' ('Persisted ' + $summary.persisted + ' jobs; failed employers: ' + $summary.failed + '; continuing review.')
   } elseif ($process.ExitCode -ne 0) { $exitCode = 1; $outcome = 'failure' }
   $runRecord.stages += @{ command = $command; exitCode = $process.ExitCode; outcome = $outcome; summary = $summary; stdout = $stdoutPath; stderr = $stderrPath }
   Write-RunRecord
   Write-LauncherLog 'command_finished' ($command + ': exit=' + $process.ExitCode + '; outcome=' + $outcome + '; stdout=' + $stdoutPath + '; stderr=' + $stderrPath)
  } finally { $process.Dispose() }
 }
 $runRecord.outcome = if ($exitCode -ne 0) { 'failure' } elseif ($hadWarnings) { 'completed_with_warnings' } else { 'success' }
 Write-LauncherLog 'finished' ('Outcome: ' + $runRecord.outcome + '; exit code: ' + $exitCode)
} catch {
 $exitCode = 1
 if ($null -ne $runRecord) { $runRecord.outcome = 'failure'; $runRecord.error = $_.Exception.Message }
 if (Get-Command Write-LauncherLog -ErrorAction SilentlyContinue) { Write-LauncherLog 'error' $_.Exception.Message }
 else { Write-Error $_.Exception.Message -ErrorAction Continue }
} finally {
 if ($null -ne $runRecord) {
  $runRecord.finishedAt = [DateTime]::UtcNow.ToString('o')
  $runRecord.exitCode = $exitCode
  try { Write-RunRecord } catch { $exitCode = 1; Write-Error ('Could not save launcher outcome: ' + $_.Exception.Message) -ErrorAction Continue }
 }
 if ($null -ne $lockStream) { $lockStream.Dispose() }
 Set-Location -LiteralPath $previousDirectory.Path
}
exit $exitCode
