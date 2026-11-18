@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Piso 3B - Voces del PC - NO CIERRES ESTA VENTANA
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
set PYTHONIOENCODING=utf-8
if not exist venv\Scripts\python.exe (
  echo Falta el entorno de Python. Ejecuta antes probar_voz.bat una vez.
  pause
  exit /b 1
)
if not exist config.txt (
  echo Primera vez: pega los dos datos de Supabase ^(clic derecho para pegar^).
  set /p U=Project URL: 
  set /p K=Clave anon / publishable: 
  > config.txt echo URL=%U%
  >> config.txt echo KEY=%K%
)
:bucle
venv\Scripts\python.exe -u worker.py
if errorlevel 2 (
  echo Falta configuracion. Borra config.txt y vuelve a abrir este archivo.
  pause
  exit /b 2
)
echo El trabajador se paro. Reintento en 15 segundos...
timeout /t 15 /nobreak >nul
goto bucle
