param(
    [string]$OutputPath,
    [int]$Width = 1280,
    [int]$Height = 720,
    [int]$ReadyFrames = 24,
    [double]$FieldReservoirScale = 0.5,
    [double]$FieldReservoirSpatialReuseBudget = 0.5,
    [int]$RetainSlots = 4,
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$fensalirRoot = "E:\Projects\Fensalir"
$engineProject = Join-Path $fensalirRoot "src\Aquarium.Engine\Aquarium.Engine.csproj"
$clientProject = Join-Path $repoRoot "src\Perlines\Perlines.csproj"
$devRoot = Join-Path $repoRoot "artifacts\headless"
$slotRoot = Join-Path $devRoot "slots"
$slotPath = Join-Path $slotRoot ("perlines-capture-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$cachePath = Join-Path $devRoot "cultcache\aquarium-client.msgpack"
$stdoutLog = Join-Path $devRoot "capture.out.log"
$stderrLog = Join-Path $devRoot "capture.err.log"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $devRoot ("perlines-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".png")
}

$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

New-Item -ItemType Directory -Force -Path $slotPath | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $cachePath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $OutputPath) | Out-Null

Write-Host "Building Perlines capture slot:"
Write-Host "  $slotPath"

dotnet build $engineProject -c Debug -o $slotPath /p:UseAppHost=true
if ($LASTEXITCODE -ne 0) {
    throw "Engine build failed with exit code $LASTEXITCODE."
}

dotnet build $clientProject -c Debug -o $slotPath /p:UseAppHost=false
if ($LASTEXITCODE -ne 0) {
    throw "Perlines client build failed with exit code $LASTEXITCODE."
}

$exePath = Join-Path $slotPath "Aquarium.Engine.exe"
$clientAssembly = Join-Path $slotPath "Perlines.dll"
$arguments = @(
    "--headless",
    "--headless-width", $Width,
    "--headless-height", $Height,
    "--client-assembly", $clientAssembly,
    "--cache", $cachePath,
    "--shader-source", (Join-Path $slotPath "Render\Shaders\D3D12HeightField.hlsl"),
    "--capture-frame", $OutputPath,
    "--field-reservoir-scale", $FieldReservoirScale,
    "--field-reservoir-spatial-reuse-budget", $FieldReservoirSpatialReuseBudget
)

$previousReadyFrames = $env:AQUARIUM_HEADLESS_READY_FRAMES
$env:AQUARIUM_HEADLESS_READY_FRAMES = [string][Math]::Max(1, $ReadyFrames)
try {
    $process = Start-Process -FilePath $exePath -ArgumentList $arguments -NoNewWindow -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
    if (-not $process.WaitForExit([Math]::Max(1, $TimeoutSeconds) * 1000)) {
        $process.Kill($true)
        $tail = if (Test-Path $stderrLog) { Get-Content -Path $stderrLog -Tail 80 } else { "<stderr missing>" }
        throw "Perlines capture timed out after $TimeoutSeconds seconds.`n$($tail -join [Environment]::NewLine)"
    }

    $process.WaitForExit()
    $process.Refresh()
    $exitCode = $process.ExitCode
    if ($null -eq $exitCode -and (Test-Path $OutputPath)) {
        $exitCode = 0
    }

    if ($exitCode -ne 0) {
        $tail = if (Test-Path $stderrLog) { Get-Content -Path $stderrLog -Tail 80 } else { "<stderr missing>" }
        throw "Perlines capture failed with exit code $exitCode.`n$($tail -join [Environment]::NewLine)"
    }
}
finally {
    $env:AQUARIUM_HEADLESS_READY_FRAMES = $previousReadyFrames
}

if (-not (Test-Path $OutputPath)) {
    throw "Perlines capture did not produce expected PNG: $OutputPath"
}

if ($RetainSlots -gt 0) {
    Get-ChildItem -Path $slotRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -Skip $RetainSlots |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Perlines frame captured:"
Write-Host "  $OutputPath"
Write-Host "Logs:"
Write-Host "  $stdoutLog"
Write-Host "  $stderrLog"
