@echo off
title Cadastra Blockchain Land Registry - Live Demonstration
echo ======================================================================
echo   CADASTRA: BLOCKCHAIN LAND REGISTRY & E-GOVERNANCE PLATFORM
echo   Target EVM: Ethereum Sepolia (Chain ID 11155111)
echo ======================================================================
echo.
echo [1/2] Checking pre-built production assets...
if not exist "frontend\dist\index.html" (
    echo Building frontend client bundle...
    cd frontend && npm run build && cd ..
)

echo [2/2] Launching live interactive platform on http://localhost:3000 ...
start http://localhost:3000
cd frontend
npm run preview -- --port 3000
