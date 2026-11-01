[CmdletBinding(SupportsShouldProcess, ConfirmImpact='Medium')]
param([string]$TaskName = 'JobAgent-DiscoveryReview')
$ErrorActionPreference = 'Stop'
if ($PSCmdlet.ShouldProcess($TaskName, 'Remove scheduled task (keep job database, reports and logs)')) {
 Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
