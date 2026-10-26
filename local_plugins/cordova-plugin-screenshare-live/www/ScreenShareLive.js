/**
 * ScreenShareLive — API JS du plugin de partage d'écran
 * Android : MediaProjection (écran complet)
 * iOS     : ReplayKit Broadcast Extension (écran complet comme WhatsApp)
 */
var exec = require("cordova/exec");

var ScreenShareLive = {
  /**
   * Vérifie si le plugin natif est disponible.
   * Sur iOS appelle le natif (ReplayKit.isAvailable).
   * Sur Android retourne true si on est bien sur la plateforme.
   */
  isAvailable: function (success, error) {
    if (typeof window === "undefined" || !window.cordova) {
      if (typeof success === "function") success(false);
      return false;
    }
    // Appelle toujours le natif pour avoir la vraie réponse (surtout iOS)
    exec(
      function (available) {
        if (typeof success === "function") success(!!available);
      },
      function (err) {
        // Classe native absente (plugin non compilé dans la plateforme) : ne pas prétendre que ça marche
        console.warn("[ScreenShareLive] isAvailable natif en échec :", err);
        if (typeof success === "function") success(false);
      },
      "ScreenShareLive",
      "isAvailable",
      []
    );
  },

  /**
   * Démarre la capture d'écran native.
   * options: {
   *   maxWidth?: number,      // défaut 720
   *   maxFps?: number,        // défaut 10
   *   jpegQuality?: number,   // 0-100 ou 0-1, défaut 55
   *   useBroadcast?: boolean  // iOS seulement, défaut true (mode WhatsApp)
   * }
   */
  start: function (options, success, error) {
    var opts = options || {};
    exec(success, error, "ScreenShareLive", "start", [opts]);
  },

  /**
   * Arrête la capture.
   */
  stop: function (success, error) {
    exec(success, error, "ScreenShareLive", "stop", []);
  },

  /**
   * Crée un MediaStream à partir des frames JPEG reçues du natif.
   * Utilisé pour replaceTrack WebRTC.
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
