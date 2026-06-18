@echo off
echo ===================================
echo  MirageCam Local Server - Install
echo ===================================
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Python non trouve. Installe Python 3.10+ depuis python.org
    pause
    exit /b 1
)

echo [1/3] Creation de l'environnement virtuel...
python -m venv venv
call venv\Scripts\activate

echo [2/3] Installation des dependances...
pip install -r requirements.txt

echo [3/3] Preparation du dossier modeles...
if not exist "models" mkdir models
echo Le modele sera telecharge automatiquement au premier demarrage.

echo.
echo Installation terminee!
echo Lance start.bat pour demarrer le serveur.
pause
