import { 
  N8N_WEBHOOK_URL, 
  N8N_TIMEOUT, 
  BOT_NAME, 
  WORKER_ID 
} from '../config/index.js';
import { getCostaRicaHour, isSleepTime } from './utils.js';
import { saveBase64Audio } from './media.js';

// ═══════════════════════════════════════════════════════════════════════════════
// COMUNICACIÓN CON N8N (CON SOPORTE AUDIO BASE64)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Envía datos a n8n y procesa la respuesta
 * Soporta:
 * - Respuestas de texto simples
 * - Respuestas múltiples (array)
 * - Audio en base64 (se convierte a OGG Opus)
 * - Audio por URL
 */
export async function sendToN8N(phone, data) {
  if (!N8N_WEBHOOK_URL) {
    console.error(`   ❌ N8N_WEBHOOK_URL no configurado`);
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), N8N_TIMEOUT);

  try {
    // Construir payload
    const payload = {
      phone,
      type: data.type || 'text',
      message: data.text || '',
      has_media: data.mediaList && data.mediaList.length > 0,
      media_count: data.mediaList?.length || 0,
      message_id: data.msgId,
      timestamp: new Date().toISOString(),
      bot_name: BOT_NAME,
      worker_id: WORKER_ID,
      cr_hour: getCostaRicaHour(),
      is_sleep_time: isSleepTime(),
    };

    // Añadir información de media si existe
    if (data.mediaList && data.mediaList.length > 0) {
      payload.media_list = data.mediaList;
      // Compatibilidad con workflows que esperan un solo media
      payload.media_url = data.mediaList[0].url;
      payload.media_type = data.mediaList[0].mimetype;
      payload.media_filename = data.mediaList[0].filename;
      payload.media_size = data.mediaList[0].size;
    }

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`n8n status ${response.status}`);
    }

    const responseData = await response.json();

    // Parsear respuestas de texto (múltiples formatos soportados)
    let replies = [];
    
    if (Array.isArray(responseData.output)) {
      replies = responseData.output.filter(r => r);
    } else if (Array.isArray(responseData.replies)) {
      replies = responseData.replies.filter(r => r);
    } else if (Array.isArray(responseData.messages)) {
      replies = responseData.messages.filter(r => r);
    } else {
      const singleReply = responseData.output || 
                          responseData.reply || 
                          responseData.message || 
                          responseData.text;
      if (singleReply) replies = [singleReply];
    }

    // Procesar audio si viene en la respuesta
    let audioData = null;
    
    if (responseData.audio_base64) {
      const mimetype = responseData.audio_mimetype || 
                       responseData.audio_mime || 
                       'audio/mpeg';
      audioData = await saveBase64Audio(responseData.audio_base64, mimetype);
      
      if (audioData) {
        console.log(`   🎵 Audio procesado: ${audioData.filename}`);
      }
    }

    // Determinar tipo de respuesta
    let replyType = responseData.type || 'text';
    if (audioData) replyType = 'audio';

    return {
      replies,
      audioData,
      audioUrl: responseData.audio_url || responseData.audioUrl || null,
      replyType,
      raw: responseData
    };

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Timeout n8n');
    }
    throw error;
  }
}
