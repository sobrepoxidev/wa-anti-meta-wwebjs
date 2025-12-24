import { HUMAN_BEHAVIOR_CONFIG, WORKER_ID } from '../config/index.js';
import { randomBetween, safeSleep, normalizeIdentifier } from './utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SMART MESSAGE QUEUE v2 - CON DETECCIÓN DE ACTIVIDAD DEL USUARIO
// ═══════════════════════════════════════════════════════════════════════════════
// 
// Esta cola inteligente detecta cuando el usuario está escribiendo o grabando
// y pausa/reinicia el timer de batching automáticamente.
//
// Flujo:
// 1. Usuario envía mensaje → Timer de 4s
// 2. Usuario empieza a escribir → Timer PAUSADO
// 3. Usuario deja de escribir → Timer REINICIA desde 4s
// 4. Timer expira sin actividad → FLUSH batch
//
// ═══════════════════════════════════════════════════════════════════════════════

class SmartMessageQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.lastProcessedIdentifier = null;
    this.userBuffers = new Map();     // identifier → buffer data
    this.userActivity = new Map();    // identifier → { isTyping, isRecording, lastActivityTime }
    this.processCallback = null;      // Se establece desde worker.js
    this.stats = { 
      totalProcessed: 0, 
      totalBatched: 0, 
      contextSwitches: 0, 
      crossWorkerMessages: 0, 
      mediaMessages: 0, 
      reactions: 0,
      audioResponses: 0,
      activityDetections: 0,
      activityPauses: 0
    };
  }

  /**
   * Establece el callback para procesar mensajes
   */
  setProcessCallback(callback) {
    this.processCallback = callback;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DETECCIÓN DE ACTIVIDAD DEL USUARIO
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Actualiza el estado de actividad del usuario (typing/recording)
   * Llamado desde el evento chat_state_changed de WhatsApp
   */
  updateUserActivity(identifier, state) {
    // state puede ser: 'typing', 'recording', 'composing', 'paused', 'available'
    const isActive = state === 'typing' || state === 'recording' || state === 'composing';
    
    let activity = this.userActivity.get(identifier);
    if (!activity) {
      activity = { isTyping: false, isRecording: false, lastActivityTime: 0 };
      this.userActivity.set(identifier, activity);
    }

    const wasActive = activity.isTyping || activity.isRecording;
    
    activity.isTyping = state === 'typing' || state === 'composing';
    activity.isRecording = state === 'recording';
    
    if (isActive) {
      activity.lastActivityTime = Date.now();
      this.stats.activityDetections++;
    }

    const buffer = this.userBuffers.get(identifier);
    
    // Solo loguear si hay buffer activo para este usuario
    if (buffer && buffer.messages.length > 0) {
      const stateEmoji = activity.isTyping ? '⌨️' : activity.isRecording ? '🎙️' : '💤';
      console.log(`   ${stateEmoji} [${WORKER_ID}] Usuario ${identifier.slice(-6)}: ${state}`);
    }

    // Si el usuario DEJÓ de estar activo, programar flush con delay
    if (wasActive && !isActive) {
      this._scheduleFlushAfterInactivity(identifier);
    }

    // Si el usuario EMPEZÓ a estar activo, cancelar flush pendiente
    if (!wasActive && isActive) {
      this._pauseFlush(identifier);
    }
  }

  /**
   * Verifica si un usuario está activo (escribiendo o grabando)
   */
  isUserActive(identifier) {
    const activity = this.userActivity.get(identifier);
    return activity && (activity.isTyping || activity.isRecording);
  }

  /**
   * Pausa el flush mientras el usuario está activo
   */
  _pauseFlush(identifier) {
    const buffer = this.userBuffers.get(identifier);
    if (buffer && buffer.flushTimeout) {
      clearTimeout(buffer.flushTimeout);
      buffer.flushTimeout = null;
      buffer.isPaused = true;
      this.stats.activityPauses++;
      console.log(`   ⏸️  [${WORKER_ID}] Flush PAUSADO - usuario activo`);
    }
  }

  /**
   * Programa flush después de que el usuario deje de estar activo
   */
  _scheduleFlushAfterInactivity(identifier) {
    const buffer = this.userBuffers.get(identifier);
    if (!buffer || buffer.messages.length === 0) return;

    // Cancelar timeout anterior si existe
    if (buffer.flushTimeout) {
      clearTimeout(buffer.flushTimeout);
    }

    buffer.isPaused = false;
    const config = HUMAN_BEHAVIOR_CONFIG.smartQueue;
    const windowMs = buffer.hasMedia ? config.mediaWindowMs : config.baseWindowMs;

    console.log(`   ▶️  [${WORKER_ID}] Usuario inactivo - flush en ${windowMs}ms`);

    buffer.flushTimeout = setTimeout(() => {
      // Verificar que sigue inactivo antes de hacer flush
      if (this.isUserActive(identifier)) {
        // Todavía activo, reprogramar
        console.log(`   🔄 [${WORKER_ID}] Usuario volvió a activarse - reprogramando`);
        this._scheduleFlushAfterInactivity(identifier);
        return;
      }
      this._flushUserBuffer(identifier);
    }, windowMs);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ENCOLADO DE MENSAJES
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Encola un mensaje para batching inteligente
   */
  enqueue(messageData, identifier, realPhone, isCrossWorker = false) {
    const config = HUMAN_BEHAVIOR_CONFIG.smartQueue;
    
    if (!config.enabled) {
      this._processDirectly(messageData, identifier, realPhone, isCrossWorker);
      return;
    }

    const now = Date.now();
    let buffer = this.userBuffers.get(identifier);

    if (!buffer) {
      buffer = { 
        messages: [], 
        firstMessageTime: now, 
        flushTimeout: null,
        isPaused: false,
        isCrossWorker, 
        realPhone, 
        hasMedia: false, 
        hasAudio: false 
      };
      this.userBuffers.set(identifier, buffer);
    }

    // Añadir mensaje al buffer
    buffer.messages.push({ ...messageData, timestamp: now });
    
    // Actualizar flags de media
    if (messageData.type !== 'text') {
      buffer.hasMedia = true;
      if (messageData.type === 'audio') buffer.hasAudio = true;
    }

    const cwTag = isCrossWorker ? ' [CW]' : '';
    const mediaTag = messageData.type !== 'text' ? ` [${messageData.type.toUpperCase()}]` : '';
    console.log(`📥 [${WORKER_ID}] Buffer ${realPhone}: ${buffer.messages.length} msgs${mediaTag}${cwTag}`);

    // Verificar límite de batch
    if (buffer.messages.length >= config.maxBatchSize) {
      console.log(`   📦 Max batch (${config.maxBatchSize}) - flush inmediato`);
      this._flushUserBuffer(identifier);
      return;
    }

    // Verificar tiempo máximo de espera
    if (now - buffer.firstMessageTime > config.maxWaitTimeMs) {
      console.log(`   ⏰ Tiempo máximo (${config.maxWaitTimeMs}ms) - flush inmediato`);
      this._flushUserBuffer(identifier);
      return;
    }

    // Verificar si el usuario está activo
    if (this.isUserActive(identifier)) {
      // Usuario activo - NO programar flush, esperar a que termine
      if (buffer.flushTimeout) {
        clearTimeout(buffer.flushTimeout);
        buffer.flushTimeout = null;
      }
      buffer.isPaused = true;
      console.log(`   ⏸️  [${WORKER_ID}] Usuario activo - esperando que termine...`);
    } else {
      // Usuario inactivo - programar flush
      this._scheduleFlushAfterInactivity(identifier);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FLUSH Y PROCESAMIENTO
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Flush del buffer de un usuario
   */
  _flushUserBuffer(identifier) {
    const buffer = this.userBuffers.get(identifier);
    if (!buffer || buffer.messages.length === 0) return;

    if (buffer.flushTimeout) {
      clearTimeout(buffer.flushTimeout);
    }

    const waitTime = Date.now() - buffer.firstMessageTime;
    const task = {
      identifier,
      realPhone: buffer.realPhone,
      messages: [...buffer.messages],
      enqueuedAt: Date.now(),
      isCrossWorker: buffer.isCrossWorker,
      hasMedia: buffer.hasMedia,
      hasAudio: buffer.hasAudio,
      waitTime
    };

    this.userBuffers.delete(identifier);
    this.queue.push(task);

    if (task.messages.length > 1) {
      this.stats.totalBatched += task.messages.length - 1;
      const mediaTypes = task.messages
        .filter(m => m.type !== 'text')
        .map(m => m.type)
        .join('+');
      console.log(`   📦 [${WORKER_ID}] Batch: ${task.messages.length} msgs${mediaTypes ? ` [${mediaTypes}]` : ''} (esperó ${waitTime}ms)`);
    }
    
    if (task.hasMedia) this.stats.mediaMessages++;

    this._processNext();
  }

  /**
   * Procesa el siguiente task en la cola
   */
  async _processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    if (!this.processCallback) {
      console.error(`❌ [${WORKER_ID}] No hay callback de procesamiento configurado`);
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift();
    const config = HUMAN_BEHAVIOR_CONFIG.smartQueue;

    try {
      // Context switch si cambiamos de usuario
      if (this.lastProcessedIdentifier && this.lastProcessedIdentifier !== task.identifier) {
        const [minSwitch, maxSwitch] = config.contextSwitchDelayMs;
        const switchDelay = randomBetween(minSwitch, maxSwitch);
        console.log(`\n🔄 [${WORKER_ID}] Cambio contexto → ${task.realPhone} (${switchDelay}ms)`);
        await safeSleep(switchDelay, 5000);
        this.stats.contextSwitches++;
      }

      this.lastProcessedIdentifier = task.identifier;
      await this._processBatchWithMedia(task);
      this.stats.totalProcessed++;
      if (task.isCrossWorker) this.stats.crossWorkerMessages++;

    } catch (error) {
      console.error(`❌ [${WORKER_ID}] Error procesando:`, error.message);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        await safeSleep(randomBetween(800, 1500), 3000);
        this._processNext();
      }
    }
  }

  /**
   * Procesa un batch combinando todos los mensajes
   */
  async _processBatchWithMedia(task) {
    const { identifier, realPhone, messages, isCrossWorker, hasAudio } = task;

    // Combinar textos y medias
    const textParts = [];
    const mediaList = [];
    let lastMessage = null;

    for (const msg of messages) {
      lastMessage = msg;
      if (msg.text) textParts.push(msg.text);
      if (msg.mediaInfo) {
        mediaList.push({
          type: msg.type,
          url: msg.mediaInfo.url,
          mimetype: msg.mediaInfo.mimetype,
          filename: msg.mediaInfo.filename,
          size: msg.mediaInfo.size
        });
      }
    }

    const combinedText = textParts.join('\n').trim();
    const batchSize = messages.length;

    // Llamar al callback de procesamiento
    await this.processCallback(
      lastMessage.originalMessage,
      identifier,
      realPhone,
      {
        type: mediaList.length > 0 ? mediaList[0].type : 'text',
        text: combinedText,
        mediaList: mediaList,
        mediaInfo: mediaList[0] || null,
        msgId: lastMessage.msgId,
        hasAudio: hasAudio,
      },
      batchSize,
      isCrossWorker
    );
  }

  /**
   * Procesa directamente sin batching (cuando está deshabilitado)
   */
  async _processDirectly(messageData, identifier, realPhone, isCrossWorker) {
    if (!this.processCallback) return;

    const mediaList = messageData.mediaInfo ? [{
      type: messageData.type,
      url: messageData.mediaInfo.url,
      mimetype: messageData.mediaInfo.mimetype,
      filename: messageData.mediaInfo.filename,
      size: messageData.mediaInfo.size
    }] : [];

    await this.processCallback(
      messageData.originalMessage,
      identifier,
      realPhone,
      {
        type: messageData.type,
        text: messageData.text,
        mediaList: mediaList,
        mediaInfo: messageData.mediaInfo,
        msgId: messageData.msgId,
        hasAudio: messageData.type === 'audio',
      },
      1,
      isCrossWorker
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Obtiene estadísticas de la cola
   */
  getStats() {
    const activeUsers = Array.from(this.userActivity.entries())
      .filter(([_, a]) => a.isTyping || a.isRecording);
    
    return {
      ...this.stats,
      currentQueueLength: this.queue.length,
      bufferedUsers: this.userBuffers.size,
      activeUsers: activeUsers.length,
      activeUserIds: activeUsers.map(([id, _]) => id.slice(-6)),
      isProcessing: this.isProcessing
    };
  }

  /**
   * Flush de todos los buffers pendientes
   */
  flushAll() {
    for (const id of this.userBuffers.keys()) {
      this._flushUserBuffer(id);
    }
  }

  /**
   * Incrementa el contador de reacciones
   */
  incrementReactions() {
    this.stats.reactions++;
  }

  /**
   * Incrementa el contador de respuestas de audio
   */
  incrementAudioResponses() {
    this.stats.audioResponses++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER PARA CONECTAR CON WHATSAPP CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configura los listeners de actividad en el cliente de WhatsApp
 */
export function setupActivityListeners(whatsappClient, queue) {
  // Listener para cambios de estado del chat (typing/recording)
  whatsappClient.on('chat_state_changed', (chat, state) => {
    try {
      const identifier = normalizeIdentifier(chat.id._serialized);
      if (identifier) {
        queue.updateUserActivity(identifier, state);
      }
    } catch (error) {
      // Ignorar errores de parsing
    }
  });

  // Listener para actualizaciones de presencia
  whatsappClient.on('presence_update', (presence) => {
    try {
      const identifier = normalizeIdentifier(presence.id);
      if (identifier) {
        // Mapear estados de presencia a nuestros estados
        let state = 'available';
        if (presence.status === 'composing') state = 'typing';
        else if (presence.status === 'recording') state = 'recording';
        
        queue.updateUserActivity(identifier, state);
      }
    } catch (error) {
      // Ignorar errores
    }
  });

  console.log(`✅ [${WORKER_ID}] Activity listeners configurados`);
}

// Singleton
export const smartQueue = new SmartMessageQueue();
