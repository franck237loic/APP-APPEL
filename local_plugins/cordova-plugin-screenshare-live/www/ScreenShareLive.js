/**
 * ScreenShareLive — API JS du plugin de partage d'écran Android (MediaProjection).
 *
 * Sur navigateur : isAvailable() = false → CallManager utilise getDisplayMedia.
 * Sur Android Cordova : start() lance le dialogue système puis envoie des frames JPEG
 * au JS pour construire un MediaStream via canvas.captureStream (replaceTrack).
 */
var exec = require("cordova/exec");

var ScreenShareLive = {
  /**
   * true si on est sur Android avec le plugin natif chargé.
   */
  isAvailable: function (success, error) {
    var ok =
      typeof window !== "undefined" &&
      window.cordova &&
      window.cordova.platformId === "android";
    if (typeof success === "function") success(ok);
    return ok;
  },

  /**
   * Démarre la capture d'écran native (dialogue système Android).
   * options: { maxWidth?: number, maxFps?: number, jpegQuality?: number }
   */
  start: function (options, success, error) {
    var opts = options || {};
    exec(success, error, "ScreenShareLive", "start", [opts]);
  },

  /**
   * Arrête la capture et le service foreground.
   */
  stop: function (success, error) {
    exec(success, error, "ScreenShareLive", "stop", []);
  },

  /**
   * Crée un MediaStream à partir des frames JPEG reçues du natif.
   * Utilise un canvas + captureStream pour replaceTrack WebRTC.
   *
   * @returns {{ stream: MediaStream, pushJpegBase64: function(string), destroy: function() }}
   */
  createCanvasStream: function (fps) {
    fps = fps || 10;
    var canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    var ctx = canvas.getContext("2d");
    var stream = canvas.captureStream(fps);
    var img = new Image();

    function pushJpegBase64(b64) {
      if (!b64) return;
      img.onload = function () {
        if (img.width && img.height) {
          if (canvas.width !== img.width || canvas.height !== img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
          }
          ctx.drawImage(img, 0, 0);
        }
      };
      img.src = "data:image/jpeg;base64," + b64;
    }

    function destroy() {
      try {
        stream.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (e) {}
    }

    return { stream: stream, pushJpegBase64: pushJpegBase64, destroy: destroy, canvas: canvas };
  },
};

module.exports = ScreenShareLive;
