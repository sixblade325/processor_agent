$ErrorActionPreference = "Stop"
$CommandArguments = @($args)
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$EntryPoint = Join-Path $RepoRoot "tools\processor-skills.py"

$Launchers = @(
    [pscustomobject]@{ Name = "python"; Prefix = @() },
    [pscustomobject]@{ Name = "python3"; Prefix = @() },
    [pscustomobject]@{ Name = "py"; Prefix = @("-3") }
)

$Selected = $null
foreach ($Launcher in $Launchers) {
    $Command = Get-Command $Launcher.Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $Command) {
        continue
    }
    $VersionOutput = & $Command.Source @($Launcher.Prefix) -c "import sys; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor))" 2>$null
    if ($LASTEXITCODE -ne 0) {
        continue
    }
    try {
        $PythonVersion = [version](([string]($VersionOutput | Select-Object -First 1)).Trim())
    }
    catch {
        continue
    }
    if ($PythonVersion -lt [version]"3.10") {
        continue
    }
    $Selected = [pscustomobject]@{
        Executable = $Command.Source
        Prefix = $Launcher.Prefix
    }
    break
}

if ($null -eq $Selected) {
    [Console]::Error.WriteLine("Processor Development Skills requires Python 3.10 or newer.")
    exit 2
}

try {
    & $Selected.Executable @($Selected.Prefix) -X utf8 $EntryPoint @CommandArguments
    $ChildExitCode = $LASTEXITCODE
}
catch {
    [Console]::Error.WriteLine("Processor Development Skills launcher failed: $($_.Exception.Message)")
    exit 4
}
if ($null -eq $ChildExitCode) {
    [Console]::Error.WriteLine("Processor Development Skills launcher did not receive a child exit code.")
    exit 4
}
exit ([int]$ChildExitCode)
