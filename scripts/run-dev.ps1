param(
    [switch]$Headless
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$fensalir = "E:\Projects\Fensalir"
$client = "E:\Projects\Perlines\src\Perlines\Perlines.csproj"

if ($Headless) {
    & (Join-Path $fensalir "scripts\dev-reload.ps1") -Headless -ClientProject $client
}
else {
    & (Join-Path $fensalir "scripts\dev-reload.ps1") -ClientProject $client
}
