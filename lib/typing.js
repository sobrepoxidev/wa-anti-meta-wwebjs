import { HUMAN_BEHAVIOR_CONFIG, WORKER_ID } from '../config/index.js';
import { randomBetween, safeSleep } from './utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULADOR DE TYPING/RECORDING HUMANO
// ═══════════════════════════════════════════════════════════════════════════════
// 
// Simula el comportamiento de escritura o grabación de un humano real:
// - Pausas intermitentes
// - "Pensando" y retomando
// - Tiempos variables
// 
// ═══════════════════════════════════════════════════════════════════════════════

export class HumanTypingSimulator {
  constructor(chat, isRecording = false) {
    this.chat = chat;
    this.isRecording = isRecording;
    this.isActive = false;
    this.intervalId = null;
    this.timeoutId = null;
    this.pauseCount = 0;
    this.startTime = null;
    this.hasSimulatedTypo = false;
  }

  async start() {
    if (this.isActive) return;
    this.isActive = true;
    this.pauseCount = 0;
    this.startTime = Date.now();
    this.hasSimulatedTypo = false;

    const config = this.isRecording 
      ? HUMAN_BEHAVIOR_CONFIG.recordingIndicator 
      : HUMAN_BEHAVIOR_CONFIG.typingIndicator;

    // Timeout de seguridad
    this.timeoutId = setTimeout(() => {
      console.log(`   ⚠️ [${WORKER_ID}] ${this.isRecording ? 'Recording' : 'Typing'} timeout`);
      this.stop();
    }, HUMAN_BEHAVIOR_CONFIG.typingIndicator.maxDurationMs);

    // Delay inicial antes de empezar a "escribir"
    const typingConfig = HUMAN_BEHAVIOR_CONFIG.typingIndicator;
    const [minDelay, maxDelay] = typingConfig.initialDelayBeforeTypingMs;
    await safeSleep(randomBetween(minDelay, maxDelay), 2000);
    
    if (!this.isActive) return;
    
    await this._sendState();

    // Intervalo de refresco del estado
    this.intervalId = setInterval(async () => {
      if (!this.isActive) {
        this.stop();
        return;
      }

      if (Date.now() - this.startTime > typingConfig.maxDurationMs) {
        this.stop();
        return;
      }

      // Typing intermitente (solo para typing, no recording)
      if (!this.isRecording && typingConfig.intermittentEnabled && 
          Math.random() < typingConfig.stopAndRestartProbability && !this.hasSimulatedTypo) {
        this.hasSimulatedTypo = true;
        console.log(`   ✏️  Pausa escritura (pensando...)`);
        
        try { await this.chat.clearState(); } catch (_) {}
        
        const [minStop, maxStop] = typingConfig.stopDurationMs;
        await safeSleep(randomBetween(minStop, maxStop), 5000);
        
        if (!this.isActive) return;
        
        await this._sendState();
        console.log(`   ✏️  Retomando escritura...`);
        return;
      }

      // Pausas aleatorias
      if (Math.random() < config.pauseProbability && this.pauseCount < 3) {
        this.pauseCount++;
        const [minPause, maxPause] = config.pauseDurationMs;
        await safeSleep(randomBetween(minPause, maxPause), 3000);
      }
      
      if (this.isActive) await this._sendState();
    }, config.refreshIntervalMs);
  }

  async _sendState() {
    try {
      if (this.isRecording) {
        await this.chat.sendStateRecording();
      } else {
        await this.chat.sendStateTyping();
      }
    } catch (error) {
      // Ignorar errores de estado
    }
  }

  stop() {
    this.isActive = false;
    if (this.intervalId) { 
      clearInterval(this.intervalId); 
      this.intervalId = null; 
    }
    if (this.timeoutId) { 
      clearTimeout(this.timeoutId); 
      this.timeoutId = null; 
    }
    try { 
      this.chat.clearState?.(); 
    } catch (_) {}
  }
}
