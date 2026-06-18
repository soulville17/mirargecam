@echo off
echo ===================================
echo   MirageCam Local Server v1.0
echo ===================================
echo.
echo Demarrage du serveur local...
echo Ouvre ensuite mirargecam.vercel.app dans ton navigateur.
echo.
echo [NE PAS FERMER CETTE FENETRE]
echo.

call venv\Scripts\activate
python server.py
pause
