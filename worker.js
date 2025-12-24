import express from 'express';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS DE MÓDULOS LOCALES
// ═══════════════════════════════════════════════════════════════════════════════

import {
  PORT,
  WORKER_ID,
  BASE_PATH,
  BOT_NAME,
  PUBLIC_MEDIA_URL,
  MEDIA_DIR,
  HUMAN_BEHAVIOR_CONFIG,
  validateConfig
} from './config/index.js';

import {
  randomBetween,
  safeSleep,
  getCurrentHour,
  isSleepTime,
  isNightTime,
  getTimeOfDayFactor,
  applySleepDelay,
  calculateReadingTime,
  calculateMediaViewTime,
  calculateTypingTime,
  calculateMinimumResponseTime,
  shouldQuoteMessage,
  normalizeIdentifier,
  getRealPhoneNumber,
  formatPhoneForDisplay,
  phoneToWhatsAppId,
  sendSeenRobust
} from './lib/utils.js';

import {
  getMessageType,
  downloadAndSaveMedia,
  saveBase64Audio
} from './lib/media.js';

import { orchestrator } from './lib/supabase.js';
import { smartQueue, setupActivityListeners } from './lib/queue.js';
import { HumanTypingSimulator } from './lib/typing.js';
import { shouldReact, sendReaction } from './lib/reactions.js';
import { sendToN8N } from './lib/n8n.js';
import { behaviorVariator } from './lib/behavior.js';

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════════

validateConfig();

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTE WHATSAPP
// ═══════════════════════════════════════════════════════════════════════════════

const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    dataPath: `./.wwebjs_auth_${WORKER_ID}`,
    clientId: WORKER_ID
  }),
  puppeteer: {
    headless: true,
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
    ],
  },
});

let whatsappReady = false;
let connectedNumber = null;
const processedMessages = new Set();

// ═══════════════════════════════════════════════════════════════════════════════
// EVENTOS DE WHATSAPP
// ═══════════════════════════════════════════════════════════════════════════════

whatsappClient.on('qr', (qr) => {
  console.log(`\n📱 [${WORKER_ID}] ESCANEA ESTE QR:\n`);
  qrcode.generate(qr, { small: true });
});

whatsappClient.on('ready', async () => {
  connectedNumber = whatsappClient.info?.wid?._serialized || 'unknown';
  const currentHour = getCurrentHour();

  console.log(`\n✅ [${WORKER_ID}] WhatsApp conectado`);
  console.log(`📲 Cuenta: ${connectedNumber}`);
  console.log(`🔌 Puerto: ${PORT}`);
  console.log(`🛡️  Anti-detección v4.2: ACTIVO`);
  console.log(`🧠 Smart Queue: ${HUMAN_BEHAVIOR_CONFIG.smartQueue.enabled ? 'ON' : 'OFF'}`);
  console.log(`🕐 Time: ${currentHour}:00 | Mode: ${isSleepTime() ? '😴 SLEEP' : isNightTime() ? '🌙 NIGHT' : '☀️ DAY'}`);
  console.log(`📁 Media: ${PUBLIC_MEDIA_URL}${BASE_PATH}/media/`);

  whatsappReady = true;
  
  // Iniciar orquestador
  await orchestrator.start();
  
  // Configurar listeners de actividad para Smart Queue
  setupActivityListeners(whatsappClient, smartQueue);
});

whatsappClient.on('disconnected', async (reason) => {
  console.log(`❌ [${WORKER_ID}] WhatsApp desconectado:`, reason);
  whatsappReady = false;
  await orchestrator.stop();
});

whatsappClient.on('message', handleIncomingMessage);

// Inicializar cliente
whatsappClient.initialize();

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURAR CALLBACK DE PROCESAMIENTO PARA LA COLA
// ═══════════════════════════════════════════════════════════════════════════════

smartQueue.setProcessCallback(processMessageWithHumanBehavior);

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER DE MENSAJES ENTRANTES
// ═══════════════════════════════════════════════════════════════════════════════

async function handleIncomingMessage(message) {
  const msgId = message.id._serialized;

  // Deduplicación
  if (processedMessages.has(msgId)) return;
  processedMessages.add(msgId);
  setTimeout(() => processedMessages.delete(msgId), 300000);

  // Filtros básicos
  if (message.fromMe) return;
  if (message.from.includes('@g.us') || message.from.includes('@broadcast')) return;

  const identifier = normalizeIdentifier(message.from);
  if (!identifier) return;

  const messageType = getMessageType(message);
  const userText = (message.body || '').trim();

  // Ignorar mensajes de texto vacíos
  if (!userText && messageType === 'text') return;

  const realPhone = await getRealPhoneNumber(message);

  // Log del mensaje
  const displayId = identifier !== realPhone.replace('+', '')
    ? `${realPhone} (id:${identifier.slice(-6)})` : realPhone;
  const typeTag = messageType !== 'text' ? ` [${messageType.toUpperCase()}]` : '';
  const textPreview = userText ? `"${userText.substring(0, 30)}..."` : '(sin texto)';
  const timeTag = isSleepTime() ? ' 😴' : isNightTime() ? ' 🌙' : '';
  
  console.log(`\n📩 [${WORKER_ID}] ${displayId}${typeTag}: ${textPreview}${timeTag}`);

  // Claim del mensaje en el orquestador
  const claim = await orchestrator.tryClaimMessage(msgId, identifier);

  if (!claim.shouldProcess) {
    const reason = claim.reason || 'unknown';
    if (reason !== 'chat_assigned_to_other_worker' && reason !== 'chat_should_go_to_other_worker') {
      console.log(`   ⏭️  Ignorando: ${reason}`);
    } else {
      console.log(`   ⏭️  Asignado a ${claim.assignedWorker}`);
    }
    return;
  }

  if (claim.isCrossWorker) {
    console.log(`   🔀 CROSS-WORKER: Ayudando a ${claim.assignedWorker}`);
  } else {
    console.log(`   ✓  Claim OK`);
  }

  // Descargar media si existe
  let mediaInfo = null;
  if (messageType !== 'text' && message.hasMedia) {
    mediaInfo = await downloadAndSaveMedia(message);
    if (mediaInfo) mediaInfo.type = messageType;
  }

  // Encolar mensaje
  const messageData = {
    originalMessage: message,
    type: messageType,
    text: userText,
    mediaInfo: mediaInfo,
    msgId: msgId,
  };

  smartQueue.enqueue(messageData, identifier, realPhone, claim.isCrossWorker);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESAMIENTO CON COMPORTAMIENTO HUMANO v4.2
// ═══════════════════════════════════════════════════════════════════════════════

async function processMessageWithHumanBehavior(message, identifier, realPhone, data, batchSize = 1, isCrossWorker = false) {
  const startTime = Date.now();
  const cwTag = isCrossWorker ? ' [CW]' : '';
  const typeTag = data.type !== 'text' ? ` [${data.type.toUpperCase()}]` : '';

  console.log(`\n🤖 [${WORKER_ID}] Procesando ${realPhone}${typeTag}${cwTag}`);
  console.log(`   📊 Chars: ${data.text?.length || 0} | Batch: ${batchSize} | Medias: ${data.mediaList?.length || 0}`);

  const variationFactor = behaviorVariator.getVariationFactor(identifier);
  let stateSimulator = null;

  const PROCESSING_TIMEOUT = 180000;
  let processingTimedOut = false;

  const processingTimeout = setTimeout(() => {
    processingTimedOut = true;
    console.log(`   ⚠️ TIMEOUT: ${PROCESSING_TIMEOUT / 1000}s`);
    if (stateSimulator) stateSimulator.stop();
  }, PROCESSING_TIMEOUT);

  try {
    const chat = await message.getChat();

    // Apply sleep delay if in sleep hours
    await applySleepDelay();
    
    await safeSleep(randomBetween(150, 350), 500);
    if (processingTimedOut) throw new Error('Processing timeout');

    // ─────────────────────────────────────────────────────────────────────────
    // PASO 1: SEEN
    // ─────────────────────────────────────────────────────────────────────────
    if (HUMAN_BEHAVIOR_CONFIG.seen.sendSeenBeforeTyping) {
      const seenSuccess = await sendSeenRobust(chat, message);
      console.log(seenSuccess ? `   👁️  Visto` : `   ⚠️  No seen`);
      const [minDelay, maxDelay] = HUMAN_BEHAVIOR_CONFIG.seen.delayAfterSeenMs;
      await safeSleep(randomBetween(minDelay, maxDelay), 2000);
    }

    if (processingTimedOut) throw new Error('Processing timeout');

    // ─────────────────────────────────────────────────────────────────────────
    // PASO 2: REACCIÓN OCASIONAL
    // ─────────────────────────────────────────────────────────────────────────
    const reactionEmoji = shouldReact(data.type, data.text);
    if (reactionEmoji) {
      await sendReaction(message, reactionEmoji);
      smartQueue.incrementReactions();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PASO 3: TIEMPO DE LECTURA
    // ─────────────────────────────────────────────────────────────────────────
    let readingTime = Math.floor(calculateReadingTime(data.text) * variationFactor);
    
    // Más tiempo si hay múltiples mensajes
    if (batchSize > 1) {
      readingTime = Math.floor(readingTime * (1 + (batchSize - 1) * 0.3));
    }
    
    // Añadir tiempo de visualización de media
    if (data.mediaList && data.mediaList.length > 0) {
      for (const media of data.mediaList) {
        readingTime += calculateMediaViewTime(media.type);
      }
    }
    
    console.log(`   📖 Leyendo: ${readingTime}ms`);
    await safeSleep(readingTime, 15000);

    if (processingTimedOut) throw new Error('Processing timeout');

    // ─────────────────────────────────────────────────────────────────────────
    // PASO 4: ESTADO (TYPING O RECORDING)
    // ─────────────────────────────────────────────────────────────────────────
    // Si usuario envió audio → mostrar "grabando"
    const useRecording = data.hasAudio;
    stateSimulator = new HumanTypingSimulator(chat, useRecording);
    await stateSimulator.start();
    console.log(useRecording ? `   🎙️  Grabando` : `   ⌨️  Typing`);

    // ─────────────────────────────────────────────────────────────────────────
    // PASO 5: LLAMADA A N8N
    // ─────────────────────────────────────────────────────────────────────────
    const n8nStartTime = Date.now();
    const n8nResponse = await sendToN8N(realPhone, data);
    const n8nTime = Date.now() - n8nStartTime;
    console.log(`   🤖 n8n: ${n8nTime}ms`);

    if (processingTimedOut) throw new Error('Processing timeout');

    if (n8nResponse) {
      const { replies, audioData, replyType } = n8nResponse;

      // ─────────────────────────────────────────────────────────────────────────
      // PASO 6: CALCULAR TIEMPOS DE RESPUESTA
      // ─────────────────────────────────────────────────────────────────────────
      const firstReply = replies[0] || '';
      const typingTimeNeeded = Math.floor(calculateTypingTime(firstReply) * variationFactor);
      const minResponseTime = Math.floor(calculateMinimumResponseTime(firstReply) * variationFactor);
      const totalElapsed = Date.now() - startTime;
      const timeNeeded = Math.max(typingTimeNeeded, minResponseTime);
      const additionalWait = Math.max(0, Math.min(timeNeeded - totalElapsed, 30000));

      if (additionalWait > 0) {
        console.log(`   ⏳ Espera: ${additionalWait}ms`);
        await safeSleep(additionalWait, 30000);
      }

      if (processingTimedOut) throw new Error('Processing timeout');

      stateSimulator.stop();
      await safeSleep(randomBetween(200, 600), 1000);

      const finalTime = Date.now() - startTime;

      // ─────────────────────────────────────────────────────────────────────────
      // PASO 7: ENVIAR RESPUESTAS
      // ─────────────────────────────────────────────────────────────────────────
      if (replyType === 'audio' && audioData) {
        // Respuesta de audio
        try {
          const { base64, mimetype, filename } = audioData;
          console.log(`   🎵 Enviando audio: ${filename}`);
          
          const audioMedia = new MessageMedia(mimetype, base64, filename);
          await chat.sendMessage(audioMedia, { sendAudioAsVoice: true });
          
          console.log(`   ✅ Audio enviado | ${finalTime}ms`);
          smartQueue.incrementAudioResponses();
        } catch (audioError) {
          console.error(`   ⚠️ Error audio:`, audioError.message);
          // Fallback a texto
          if (replies[0]) {
            await chat.sendMessage(replies[0]);
            console.log(`   ✅ Texto fallback | ${finalTime}ms`);
          }
        }
      } else if (replies.length > 0) {
        // Mensajes de texto
        for (let i = 0; i < replies.length; i++) {
          const reply = replies[i];
          if (!reply) continue;

          // Delay entre mensajes múltiples
          if (i > 0 && HUMAN_BEHAVIOR_CONFIG.splitMessages.enabled) {
            const [minDelay, maxDelay] = HUMAN_BEHAVIOR_CONFIG.splitMessages.delayBetweenMs;
            const betweenDelay = randomBetween(minDelay, maxDelay);
            
            if (HUMAN_BEHAVIOR_CONFIG.splitMessages.showTypingBetween) {
              await chat.sendStateTyping();
            }
            
            console.log(`   ⏳ Entre mensajes: ${betweenDelay}ms`);
            await safeSleep(betweenDelay, 5000);
          }

          // Quote del primer mensaje si aplica
          const shouldQuote = i === 0 && shouldQuoteMessage(data.text);
          
          if (shouldQuote) {
            await message.reply(reply);
            console.log(`   ✅ [${i + 1}/${replies.length}] Quote | ${Date.now() - startTime}ms`);
          } else {
            await chat.sendMessage(reply);
            console.log(`   ✅ [${i + 1}/${replies.length}] Directo | ${Date.now() - startTime}ms`);
          }
        }
      }

      await orchestrator.markProcessed(data.msgId);
    } else {
      console.log(`   ⚠️ n8n sin respuesta`);
      stateSimulator.stop();
    }

  } catch (error) {
    console.error(`   ❌ Error:`, error.message);
    if (stateSimulator) stateSimulator.stop();

    // Enviar mensaje de error si no fue timeout
    if (!processingTimedOut && error.message !== 'Processing timeout') {
      await safeSleep(randomBetween(2300, 4600), 5000);
      try {
        await (await message.getChat()).sendMessage('Disculpa, hubo un problema. Intenta de nuevo. 🙏');
      } catch (_) {}
    }
  } finally {
    clearTimeout(processingTimeout);
    if (stateSimulator) stateSimulator.stop();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// API EXPRESS
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json({ limit: '50mb' }));

// Servir archivos multimedia
app.use(`${BASE_PATH}/media`, express.static(MEDIA_DIR, {
  maxAge: '1h',
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=3600');
  }
}));

// Health check
app.get(`${BASE_PATH}/health`, async (req, res) => {
  const currentHour = getCurrentHour();
  res.json({
    status: 'ok',
    worker_id: WORKER_ID,
    port: PORT,
    version: 'v4.2',
    whatsapp_connected: whatsappReady,
    connected_number: connectedNumber,
    smart_queue: smartQueue.getStats(),
    media_url: `${PUBLIC_MEDIA_URL}${BASE_PATH}/media/`,
    schedule: {
      current_hour: currentHour,
      mode: isSleepTime() ? 'sleep' : isNightTime() ? 'night' : 'day',
      slowdown_factor: getTimeOfDayFactor(),
    },
    features: {
      smart_queue: HUMAN_BEHAVIOR_CONFIG.smartQueue.enabled,
      activity_detection: true,
      reactions: HUMAN_BEHAVIOR_CONFIG.reactions.enabled,
      split_messages: HUMAN_BEHAVIOR_CONFIG.splitMessages.enabled,
      intermittent_typing: HUMAN_BEHAVIOR_CONFIG.typingIndicator.intermittentEnabled,
      audio_base64_support: true,
    }
  });
});

// Stats de orquestación
app.get(`${BASE_PATH}/orchestration/stats`, async (req, res) => {
  const stats = await orchestrator.getStats();
  res.json(stats || { error: 'No stats' });
});

// Enviar mensaje de texto
app.post(`${BASE_PATH}/send-message`, async (req, res) => {
  if (!whatsappReady) {
    return res.status(503).json({ success: false, error: 'WhatsApp no conectado' });
  }

  const { to, message, phone, text } = req.body;
  const targetPhone = to || phone;
  const messageText = message || text;

  if (!targetPhone || !messageText) {
    return res.status(400).json({ success: false, error: 'Faltan parámetros' });
  }

  try {
    const normalized = formatPhoneForDisplay(targetPhone);
    if (!normalized) {
      return res.status(400).json({ success: false, error: 'Número inválido' });
    }

    const chatId = phoneToWhatsAppId(normalized);
    const chat = await whatsappClient.getChatById(chatId);

    await chat.sendStateTyping();
    await safeSleep(Math.min(calculateTypingTime(messageText), 5750), 6000);
    await whatsappClient.sendMessage(chatId, messageText);

    console.log(`📤 [${WORKER_ID}] Enviado a ${normalized} vía API`);
    res.json({ success: true, phone: normalized, worker: WORKER_ID });
  } catch (error) {
    console.error(`❌ [${WORKER_ID}] /send-message:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enviar audio
app.post(`${BASE_PATH}/send-audio`, async (req, res) => {
  if (!whatsappReady) {
    return res.status(503).json({ success: false, error: 'WhatsApp no conectado' });
  }

  const { to, phone, audio_url, audioUrl, audio_base64, audio_mimetype } = req.body;
  const targetPhone = to || phone;
  let audioData = null;

  // Si viene base64, procesarlo
  if (audio_base64) {
    const mimetype = audio_mimetype || 'audio/mpeg';
    audioData = await saveBase64Audio(audio_base64, mimetype);
  }

  const url = audio_url || audioUrl;

  if (!targetPhone || (!url && !audioData)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Faltan parámetros (phone y audio_url o audio_base64)' 
    });
  }

  try {
    const normalized = formatPhoneForDisplay(targetPhone);
    if (!normalized) {
      return res.status(400).json({ success: false, error: 'Número inválido' });
    }

    const chatId = phoneToWhatsAppId(normalized);
    const chat = await whatsappClient.getChatById(chatId);

    await chat.sendStateRecording();
    await safeSleep(randomBetween(2000, 4000), 5000);

    let audioMedia;
    if (audioData) {
      audioMedia = new MessageMedia(audioData.mimetype, audioData.base64, audioData.filename);
    } else {
      audioMedia = await MessageMedia.fromUrl(url);
    }
    
    await chat.sendMessage(audioMedia, { sendAudioAsVoice: true });

    console.log(`📤 [${WORKER_ID}] Audio enviado a ${normalized}`);
    res.json({ success: true, phone: normalized, worker: WORKER_ID });
  } catch (error) {
    console.error(`❌ [${WORKER_ID}] /send-audio:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════════

async function gracefulShutdown(signal) {
  console.log(`\n🛑 [${WORKER_ID}] ${signal} recibido...`);
  smartQueue.flushAll();
  await orchestrator.stop();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error(`💥 [${WORKER_ID}] Uncaught:`, error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error(`💥 [${WORKER_ID}] Unhandled:`, reason);
});

// ═══════════════════════════════════════════════════════════════════════════════
// INICIO DEL SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  const currentHour = getCurrentHour();
  const config = HUMAN_BEHAVIOR_CONFIG;

  console.log(`\n🌳 [${WORKER_ID}] ${BOT_NAME} Worker v4.2`);
  console.log(`🔌 Puerto: ${PORT}`);
  console.log(`🕐 Time: ${currentHour}:00`);
  console.log(`📁 Media: ${PUBLIC_MEDIA_URL}${BASE_PATH}/media/`);
  console.log(`🛡️  Anti-detección v4.2: READY`);
  console.log(`   ├─ Smart Queue: ON`);
  console.log(`   │  ├─ Base window: ${config.smartQueue.baseWindowMs}ms`);
  console.log(`   │  ├─ Media window: ${config.smartQueue.mediaWindowMs}ms`);
  console.log(`   │  ├─ Max wait: ${config.smartQueue.maxWaitTimeMs}ms`);
  console.log(`   │  └─ Activity detection: ON`);
  console.log(`   ├─ Reacciones: ${config.reactions.probability * 100}%`);
  console.log(`   ├─ Typing intermitente: ON`);
  console.log(`   ├─ Mensajes divididos: ON`);
  console.log(`   ├─ Audio Base64 + ffmpeg: ON`);
  console.log(`   ├─ Sleep mode (${config.schedule.sleepHoursStart}-${config.schedule.sleepHoursEnd}): ${config.schedule.sleepSlowdownFactor}x`);
  console.log(`   └─ Night mode: ${config.schedule.nightSlowdownFactor}x\n`);
});
