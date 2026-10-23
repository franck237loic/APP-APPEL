# Guide de création du Plugin ScreenShareLive

## Problème

Les fichiers du plugin ne persistent pas dans l'environnement Windows actuel. Vous devez les créer manuellement.

## Structure à créer

```
plugins/cordova-plugin-screenshare-live/
├── package.json
├── plugin.xml
├── www/
│   └── ScreenShareLive.js
└── src/android/
    ├── ScreenShareLivePlugin.java
    └── ScreenShareService.java
```

## Étape 1 : Créer les dossiers

```bash
mkdir -p plugins/cordova-plugin-screenshare-live/www
mkdir -p plugins/cordova-plugin-screenshare-live/src/android
```

## Étape 2 : Créer les fichiers

### package.json

Créez `plugins/cordova-plugin-screenshare-live/package.json` :

```json
{
  "name": "cordova-plugin-screenshare-live",
  "version": "1.0.0",
  "description": "Plugin Cordova pour le partage d'écran en direct sur Android via MediaProjection",
  "cordova": {
    "id": "cordova-plugin-screenshare-live",
    "platforms": ["android"]
  },
  "keywords": ["cordova", "android", "screenshare", "mediaprojection", "webrtc"],
  "author": "CallApp Team",
  "license": "MIT"
}
```

### plugin.xml

Créez `plugins/cordova-plugin-screenshare-live/plugin.xml` :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plugin xmlns="http://apache.org/cordova/ns/plugins/1.0"
        id="cordova-plugin-screenshare-live"
        version="1.0.0">
  <name>ScreenShare Live</name>
  <description>Live screen sharing for Android Cordova apps using MediaProjection</description>
  <author>CallApp Team</author>
  <license>MIT</license>
  <keywords>cordova,android,screenshare,mediaprojection,webrtc</keywords>

  <platform name="android">
    <config-file target="AndroidManifest.xml" parent="/*">
      <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
      <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
      <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    </config-file>
    <config-file target="AndroidManifest.xml" parent="/application">
      <service android:name="com.callapp.screenshare.ScreenShareService"
              android:foregroundServiceType="mediaProjection"
              android:exported="false"
              android:enabled="true" />
    </config-file>
    <js-module src="www/ScreenShareLive.js" name="ScreenShareLive">
      <clobbers target="ScreenShareLive" />
    </js-module>
    <source-file src="src/android/ScreenShareLivePlugin.java" target-dir="src/com/callapp/screenshare" />
    <source-file src="src/android/ScreenShareService.java" target-dir="src/com/callapp/screenshare" />
  </platform>
</plugin>
```

### www/ScreenShareLive.js

Créez `plugins/cordova-plugin-screenshare-live/www/ScreenShareLive.js` avec le contenu complet (téléchargez-le depuis la conversation ou contactez-moi).

### src/android/ScreenShareLivePlugin.java

Créez `plugins/cordova-plugin-screenshare-live/src/android/ScreenShareLivePlugin.java` avec le contenu complet.

### src/android/ScreenShareService.java

Créez `plugins/cordova-plugin-screenshare-live/src/android/ScreenShareService.java` avec le contenu complet.

## Étape 3 : Installer le plugin

```bash
cordova plugin add ./plugins/cordova-plugin-screenshare-live
```

## Étape 4 : Builder

```bash
cordova build android
```

## Étape 5 : Tester

```bash
cordova run android
```

## Modifications déjà appliquées à CallManager.js

Les modifications suivantes sont déjà committées dans `www/js/CallManager.js` :

- `startScreenShare()` : Support 3 chemins (navigateur, natif Android, non supporté)
- `stopScreenShare()` : Arrêt du plugin natif
- Logs : `[SCREEN] path=browser|native|unsupported`

## Alternative : Publier le plugin sur npm

Si vous avez accès à npm, vous pouvez publier le plugin :

```bash
cd plugins/cordova-plugin-screenshare-live
npm publish
cordova plugin add cordova-plugin-screenshare-live
```
