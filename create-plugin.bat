@echo off
echo Création du plugin cordova-plugin-screenshare-live...

cd /d %~dp0

REM Créer la structure de dossiers
if not exist "plugins\cordova-plugin-screenshare-live\www" mkdir "plugins\cordova-plugin-screenshare-live\www"
if not exist "plugins\cordova-plugin-screenshare-live\src\android" mkdir "plugins\cordova-plugin-screenshare-live\src\android"

echo Structure de dossiers créée.
echo Veuillez créer manuellement les fichiers suivants dans plugins\cordova-plugin-screenshare-live\:
echo   - package.json
echo   - plugin.xml
echo   - www\ScreenShareLive.js
echo   - src\android\ScreenShareLivePlugin.java
echo   - src\android\ScreenShareService.java
echo.
echo Contenu disponible dans la conversation précédente.
pause
