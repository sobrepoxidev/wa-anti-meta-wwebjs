import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { HUMAN_BEHAVIOR_CONFIG, MEDIA_DIR, PUBLIC_MEDIA_URL, BASE_PATH, WORKER_ID } from '../config/index.js';

// Crear directorio de media si no existe
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE IDS Y EXTENSIONES
// ═══════════════════════════════════════════════════════════════════════════════

export function generateMediaId() {
  return crypto.randomBytes(16).toString('hex');
}

export function getExtensionFromMimetype(mimetype) {
  const baseMime = (mimetype || '').split(';')[0].trim().toLowerCase();
  
  const mimeToExt = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
    'video/webm': 'webm', 'video/x-matroska': 'mkv',
    'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a',
    'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/wave': 'wav',
    'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/amr': 'amr',
    'audio/mpga': 'mp3', 'audio/x-mpga': 'mp3',
    'application/pdf': 'pdf', 'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt', 'application/zip': 'zip',
  };
  
  if (mimetype && mimetype.includes('opus')) return 'ogg';
  if (mimetype && (mimetype.includes('mpga') || mimetype.includes('mpeg'))) return 'mp3';
  return mimeToExt[baseMime] || 'bin';
}

export function getAudioExtension(mimetype) {
  const baseMime = (mimetype || '').split(';')[0].trim().toLowerCase();
  const mimeMap = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mpga': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/webm': 'webm',
    'audio/aac': 'aac',
  };
  return mimeMap[baseMime] || 'mp3';
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIPO DE MENSAJE
// ═══════════════════════════════════════════════════════════════════════════════

export function getMessageType(message) {
  if (message.hasMedia) {
    if (message.type === 'image' || message.type === 'sticker') return 'image';
    if (message.type === 'video') return 'video';
    if (message.type === 'audio' || message.type === 'ptt') return 'audio';
    if (message.type === 'document') return 'document';
    return 'media';
  }
  return 'text';
}

// ═══════════════════════════════════════════════════════════════════════════════
// DESCARGA Y GUARDADO DE MULTIMEDIA
// ═══════════════════════════════════════════════════════════════════════════════

export async function downloadAndSaveMedia(message) {
  try {
    if (!message.hasMedia) return null;

    const media = await message.downloadMedia();
    if (!media) {
      console.log(`   ⚠️ No se pudo descargar el media`);
      return null;
    }

    console.log(`   📎 Mimetype: ${media.mimetype}`);

    const mediaId = generateMediaId();
    const ext = getExtensionFromMimetype(media.mimetype);
    const filename = `${mediaId}.${ext}`;
    const filepath = path.join(MEDIA_DIR, filename);

    console.log(`   📎 Extensión: .${ext}`);

    const buffer = Buffer.from(media.data, 'base64');
    
    if (buffer.length > HUMAN_BEHAVIOR_CONFIG.media.maxSizeBytes) {
      console.log(`   ⚠️ Archivo muy grande: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
      return null;
    }

    fs.writeFileSync(filepath, buffer);

    // Programar eliminación
    setTimeout(() => {
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          console.log(`🗑️ Media eliminado: ${filename}`);
        }
      } catch (e) {}
    }, HUMAN_BEHAVIOR_CONFIG.media.retentionMs);

    const mediaUrl = `${PUBLIC_MEDIA_URL}${BASE_PATH}/media/${filename}`;
    
    console.log(`   📁 Guardado: ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);
    
    return {
      url: mediaUrl,
      mimetype: media.mimetype,
      filename: filename,
      size: buffer.length,
    };
  } catch (error) {
    console.error(`   ❌ Error descargando media:`, error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO BASE64 CON CONVERSIÓN A OGG OPUS
// ═══════════════════════════════════════════════════════════════════════════════

export async function saveBase64Audio(base64Data, mimetype) {
  const { execSync } = await import('child_process');
  
  try {
    let cleanBase64 = base64Data;
    if (base64Data.includes(',')) {
      cleanBase64 = base64Data.split(',')[1];
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, '');
    
    const buffer = Buffer.from(cleanBase64, 'base64');
    const mediaId = generateMediaId();
    
    // Archivo temporal con extensión original
    const originalExt = getAudioExtension(mimetype);
    const tempFilename = `tmp_${mediaId}.${originalExt}`;
    const tempPath = path.join(MEDIA_DIR, tempFilename);
    fs.writeFileSync(tempPath, buffer);
    
    // Archivo final SIEMPRE en OGG Opus (requerido para WhatsApp móvil)
    const finalFilename = `resp_${mediaId}.ogg`;
    const finalPath = path.join(MEDIA_DIR, finalFilename);
    
    let finalBase64;
    let finalSize;
    
    // Si ya es OGG con opus, no convertir
    const isAlreadyOpus = mimetype && (mimetype.includes('ogg') || mimetype.includes('opus'));
    
    if (isAlreadyOpus) {
      fs.renameSync(tempPath, finalPath);
      finalBase64 = cleanBase64;
      finalSize = buffer.length;
      console.log(`   🎵 Audio OGG (sin conversión): ${finalFilename}`);
    } else {
      // Convertir a OGG Opus con ffmpeg
      try {
        execSync(
          `ffmpeg -i "${tempPath}" -c:a libopus -b:a 24k -vbr on -compression_level 10 -frame_duration 60 -application voip "${finalPath}" -y`,
          { stdio: 'pipe', timeout: 30000 }
        );
        
        const convertedBuffer = fs.readFileSync(finalPath);
        finalBase64 = convertedBuffer.toString('base64');
        finalSize = convertedBuffer.length;
        
        // Limpiar temporal
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        
        console.log(`   🔄 Convertido ${originalExt}→ogg: ${(finalSize / 1024).toFixed(1)}KB`);
      } catch (ffmpegErr) {
        console.error(`   ⚠️ ffmpeg error:`, ffmpegErr.message);
        // Fallback: intentar enviar como está
        fs.renameSync(tempPath, finalPath);
        finalBase64 = cleanBase64;
        finalSize = buffer.length;
      }
    }
    
    // Programar limpieza
    setTimeout(() => {
      try {
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      } catch (e) {}
    }, HUMAN_BEHAVIOR_CONFIG.media.audioResponseRetentionMs);
    
    return {
      filename: finalFilename,
      filepath: finalPath,
      base64: finalBase64,
      mimetype: 'audio/ogg; codecs=opus',
      size: finalSize
    };
  } catch (error) {
    console.error(`   ❌ Error saveBase64Audio:`, error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIMPIEZA DE ARCHIVOS
// ═══════════════════════════════════════════════════════════════════════════════

export function cleanupOldMedia() {
  try {
    const files = fs.readdirSync(MEDIA_DIR);
    const now = Date.now();
    let cleaned = 0;
    for (const file of files) {
      const filepath = path.join(MEDIA_DIR, file);
      const stats = fs.statSync(filepath);
      // Audios de respuesta (resp_*) tienen 1h, otros 24h
      const retention = file.startsWith('resp_') 
        ? HUMAN_BEHAVIOR_CONFIG.media.audioResponseRetentionMs 
        : HUMAN_BEHAVIOR_CONFIG.media.retentionMs;
      if (now - stats.mtimeMs > retention) {
        fs.unlinkSync(filepath);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`🧹 [${WORKER_ID}] Limpieza media: ${cleaned} archivos`);
    }
  } catch (error) {}
}

// Ejecutar limpieza cada hora
setInterval(cleanupOldMedia, 60 * 60 * 1000);
