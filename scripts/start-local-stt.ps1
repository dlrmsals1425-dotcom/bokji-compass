$ErrorActionPreference = 'Stop'
$voiceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $voiceRoot
if (Test-Path -LiteralPath '.env.local') {
    foreach ($line in Get-Content -LiteralPath '.env.local') {
        if ($line -match '^(STT_SERVICE_TOKEN|STT_MODEL_DIR)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), 'Process')
        }
    }
}
& (Join-Path $voiceRoot '.venv-stt/Scripts/python.exe') (Join-Path $voiceRoot 'local-stt/server.py')
exit $LASTEXITCODE
