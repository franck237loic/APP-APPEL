/**
 * ============================================
 *  MEETING MEDIA ADAPTER
 * ============================================
 * 
 * Ce fichier sert d'interface entre le module Meeting et le système d'appel
 * de groupe existant (CallManager).
 * 
 * RESPONSABILITÉS:
 * - Adapter les meetings aux appels de groupe existants
 * - Gérer la transition meeting → salle live
 * - Gérer les médias (caméra/micro) pour les meetings
 * - Ne PAS modifier CallManager.js
 * 
 * PRINCIPE: Utiliser les interfaces existantes de CallManager pour les appels
 * de groupe, mais isoler la logique spécifique aux meetings.
 */

class MeetingMediaAdapter {
  constructor() {
    this.callManager = null;
    this.preparedMedia = null;
    this.selectedCamera = null;
    this.selectedMicrophone = null;
    this.selectedSpeaker = null;
  }

  /**
   * Initialiser l'adaptateur avec CallManager
   */
  initialize(callManager) {
    this.callManager = callManager;
  }

  /**
   * Obtenir la liste des périphériques disponibles
   */
  async getDevices() {
    try {
      // enumerateDevices n'a pas besoin d'ouvrir le micro ni la caméra. Ouvrir
      // un flux ici puis un second pour l'aperçu fait échouer la caméra sur Android.
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        cameras: devices.filter(d => d.kind === 'videoinput'),
        microphones: devices.filter(d => d.kind === 'audioinput'),
        speakers: devices.filter(d => d.kind === 'audiooutput')
      };
    } catch (error) {
      console.error('❌ [MeetingMediaAdapter] Erreur obtention périphériques:', error);
      throw error;
    }
  }

  /**
   * Sélectionner une caméra
   */
  selectCamera(deviceId) {
    this.selectedCamera = deviceId;
  }

  /**
   * Sélectionner un microphone
   */
  selectMicrophone(deviceId) {
    this.selectedMicrophone = deviceId;
  }

  /**
   * Sélectionner un haut-parleur
   */
  selectSpeaker(deviceId) {
    this.selectedSpeaker = deviceId;
  }

  /**
   * Préparer les médias pour un aperçu
   */
  async preparePreview(isVideo = true, isAudio = true) {
    try {
      const constraints = {
        video: isVideo ? {
          deviceId: this.selectedCamera ? { exact: this.selectedCamera } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false,
        audio: isAudio ? {
          deviceId: this.selectedMicrophone ? { exact: this.selectedMicrophone } : undefined
        } : false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.preparedMedia = stream;
      return stream;
    } catch (error) {
      console.error('❌ [MeetingMediaAdapter] Erreur préparation média:', error);
      throw error;
    }
  }

  /**
   * Arrêter l'aperçu
   */
  stopPreview() {
    if (this.preparedMedia) {
      this.preparedMedia.getTracks().forEach(track => track.stop());
      this.preparedMedia = null;
    }
  }

  /**
   * Obtenir le niveau audio du microphone
   */
  async getAudioLevel(stream) {
    return new Promise((resolve, reject) => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        
        analyser.fftSize = 256;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        const checkLevel = () => {
          analyser.getByteFrequencyData(dataArray);
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const average = sum / dataArray.length;
          resolve(average);
        };
        
        checkLevel();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Transférer les médias préparés à CallManager pour rejoindre une réunion
   */
  async transferMediaToCallManager(isVideo) {
    if (!this.callManager) {
      throw new Error('CallManager non initialisé');
    }

    if (!this.preparedMedia) {
      // Si pas de média préparé, en acquérir un
      const wantsVideo = isVideo ?? meetingService.currentMeeting?.isVideo ?? true;
      await this.preparePreview(wantsVideo);
    }

    // CallManager utilise déjà acquireGroupMedia, on peut l'utiliser
    // mais on s'assure d'utiliser les périphériques sélectionnés
    const wantsVideo = isVideo ?? meetingService.currentMeeting?.isVideo ?? true;
    // Libérer l'aperçu avant d'ouvrir la caméra d'appel : Android n'autorise
    // souvent qu'une seule capture simultanée dans la WebView.
    if (this.callManager.stopPreview) {
      this.callManager.stopPreview();
    } else {
      this.stopPreview();
    }
    await this.callManager.acquireGroupMedia(wantsVideo);
  }

  /**
   * Basculer la caméra (on/off)
   */
  async toggleCamera(enabled) {
    if (!this.callManager) return;
    
    if (enabled) {
      await this.callManager.enableGroupCamera();
    } else {
      this.callManager.disableGroupCamera();
    }
  }

  /**
   * Basculer le microphone (on/off)
   */
  async toggleMicrophone(enabled) {
    if (!this.callManager) return;
    
    if (enabled) {
      await this.callManager.enableGroupMicrophone();
    } else {
      this.callManager.disableGroupMicrophone();
    }
  }

  /**
   * Rejoindre une réunion via CallManager
   */
  async joinMeeting(code) {
    if (!this.callManager) {
      throw new Error('CallManager non initialisé');
    }

    // Utiliser la méthode existante de CallManager pour rejoindre
    return this.callManager.joinMeeting(code);
  }

  /**
   * Démarrer une réunion via CallManager
   */
  async startMeeting(code) {
    if (!this.callManager) {
      throw new Error('CallManager non initialisé');
    }

    // Utiliser la méthode existante de CallManager pour démarrer
    return this.callManager.startMeeting(code);
  }

  /**
   * Quitter la réunion via CallManager
   */
  async leaveMeeting() {
    if (!this.callManager) return;

    // Utiliser la méthode existante de CallManager pour quitter
    this.callManager.endGroupCall();
  }

  /**
   * Réinitialiser l'adaptateur
   */
  reset() {
    this.stopPreview();
    this.selectedCamera = null;
    this.selectedMicrophone = null;
    this.selectedSpeaker = null;
  }
}

// Instance globale
const meetingMediaAdapter = new MeetingMediaAdapter();

// Export
window.meetingMediaAdapter = meetingMediaAdapter;
