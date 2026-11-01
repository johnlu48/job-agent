[CmdletBinding()]
param(
    [switch]$Resume,
    [switch]$ShowCommand
)

$ErrorActionPreference = 'Stop'
if ($env:CODEX_SANDBOX_NETWORK_DISABLED -eq '1') {
    throw 'Run this launcher from a normal PowerShell terminal after exiting Codex. This process is inside a network-disabled sandbox and cannot change its active restrictions.'
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$cli = Get-Command codex.cmd -ErrorAction Stop
$cliArguments = @(
    '--no-daemon',
    '--cd', $projectRoot,
    '--sandbox', 'workspace-write',
    '--ask-for-approval', 'never',
    '-c', 'sandbox_workspace_write.network_access=true'
)
if ($Resume) { $cliArguments += @('resume', '--last') }

if ($ShowCommand) {
    Write-Output ('CLI: ' + $cli.Source)
    Write-Output ('Workspace: ' + $projectRoot)
    Write-Output ('Arguments: ' + ($cliArguments -join ' '))
    return
}

Write-Host ('Starting Codex in ' + $projectRoot)
Write-Host 'Network access requested; workspace sandbox retained; command approval prompts disabled.'
Write-Host 'Shared daemon reuse disabled. Administrator policy still applies.'

# Run this launcher from the user's normal terminal. It does not modify the
# restrictions of an already-running session or override administrator policy.
& $cli.Source @cliArguments
exit $LASTEXITCODE
