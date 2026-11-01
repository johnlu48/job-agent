[CmdletBinding(SupportsShouldProcess)]
param(
 [string]$TaskName = 'JobAgent-DiscoveryReview',
 [string]$ProjectRoot = '',
 [string]$NodePath = 'node.exe'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$launcher = Join-Path $root 'scripts\Invoke-JobAgent.ps1'
if (-not (Test-Path -LiteralPath $launcher)) { throw ('Launcher not found: ' + $launcher) }
$node = (Get-Command $NodePath -CommandType Application).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -ProjectRoot "' + $root + '" -NodePath "' + $node + '"'
if ($PSCmdlet.ShouldProcess($TaskName, 'Register current-user login task for discovery/review only')) {
 if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Task already exists. Inspect or remove it before registering again.' }
 $action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $root
 $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
 $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
 $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 65)
 Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ('Job-agent discovery and review only; no application submissions. Project: ' + $root)
}
