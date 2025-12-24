import 'dotenv/config';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DEL WORKER
// ═══════════════════════════════════════════════════════════════════════════════

export const PORT = parseInt(process.env.PORT || '3001');
export const WORKER_ID = process.env.WORKER_ID || `worker-${PORT}`;
export const BASE_PATH = process.env.BASE_PATH || '/api/wa-antropy';
export const BOT_NAME = process.env.BOT_NAME || 'MyBot';
export const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
export const N8N_TIMEOUT = parseInt(process.env.N8N_TIMEOUT || '120000');

// URL pública para servir archivos multimedia
export const PUBLIC_MEDIA_URL = process.env.PUBLIC_MEDIA_URL || `http://localhost:${PORT}`;
export const MEDIA_DIR = process.env.MEDIA_DIR || './media';

// Timezone (default: America/New_York - GMT-5/GMT-4)
export const TIMEZONE = process.env.TIMEZONE || 'America/New_York';

// Supabase
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE COMPORTAMIENTO HUMANO Y ANTI-DETECCIÓN v4.2
// ═══════════════════════════════════════════════════════════════════════════════

export const HUMAN_BEHAVIOR_CONFIG = {
  reading: {
    baseTimeMs: 920,
    msPerCharacter: 52,
    maxReadingTimeMs: 4600,
    jitterPercent: 0.3,
    imageViewTimeMs: [2000, 4000],
    videoViewTimeMs: [3000, 6000],
    audioListenTimeMs: [1500, 3500],
  },
  typing: {
    msPerCharacter: 40,
    minTypingTimeMs: 2300,
    maxTypingTimeMs: 52000,
    jitterPercent: 0.25,
    absoluteMaxTypingMs: 180000,
  },
  response: {
    absoluteMinimumMs: 4025,
    shortMessageMinMs: 4600,
    mediumMessageMinMs: 6900,
    longMessageMinMs: 11500,
    jitterRangeMs: [575, 2875],
  },
  typingIndicator: {
    refreshIntervalMs: 8000,
    intermittentEnabled: true,
    pauseProbability: 0.40,
    pauseDurationMs: [920, 2875],
    stopAndRestartProbability: 0.15,
    stopDurationMs: [1500, 4000],
    initialDelayBeforeTypingMs: [345, 1380],
    maxDurationMs: 180000,
  },
  recordingIndicator: {
    refreshIntervalMs: 5000,
    pauseProbability: 0.25,
    pauseDurationMs: [500, 1500],
  },
  replyBehavior: {
    quoteMessageProbability: 0.65,
    quoteIfMessageLongerThan: 100,
    neverQuoteIfShorterThan: 15,
  },
  seen: {
    sendSeenBeforeTyping: true,
    delayAfterSeenMs: [460, 1725],
    retryAttempts: 2,
    retryDelayMs: 300,
  },
  reactions: {
    enabled: true,
    probability: 0.08,
    reactToTypes: ['text', 'image', 'video'],
    positiveEmojis: ['👍', '😊', '🙌', '✨', '💚'],
    acknowledgmentEmojis: ['👀', '🤔', '📝'],
    delayBeforeReactMs: [300, 1200],
  },
  schedule: {
    enabled: true,
    timezone: 'America/Costa_Rica',
    sleepHoursStart: 1,
    sleepHoursEnd: 5,
    sleepInitialDelayMs: [15000, 45000],
    sleepSlowdownFactor: 2.5,
    nightHoursStart: 22,
    nightHoursEnd: 7,
    nightSlowdownFactor: 1.4,
  },
  patterns: {
    varyBehaviorEveryNMessages: 5,
    behaviorVariationPercent: 0.15,
  },
  typos: {
    enabled: true,
    probability: 0.03,
  },
  splitMessages: {
    enabled: true,
    delayBetweenMs: [1500, 4000],
    showTypingBetween: true,
  },
  multiWorker: {
    enabled: true,
    crossWorkerProbability: 0.08,
    crossWorkerEveryNMessages: 15,
    heartbeatIntervalMs: 10000,
    cleanupIntervalMs: 60000,
  },
  // NUEVO: Configuración de Smart Queue v2
  smartQueue: {
    enabled: true,
    baseWindowMs: 4000,              // Ventana base después de inactividad
    mediaWindowMs: 5000,             // Ventana extra después de media
    maxWaitTimeMs: 30000,            // Máximo tiempo de espera total
    maxBatchSize: 8,                 // Máximo mensajes por batch
    inactivityThresholdMs: 3000,     // Tiempo sin actividad = "inactivo"
    contextSwitchDelayMs: [1500, 3500],
  },
  media: {
    retentionMs: 24 * 60 * 60 * 1000,
    audioResponseRetentionMs: 60 * 60 * 1000,
    allowedTypes: ['image', 'video', 'audio', 'document', 'sticker'],
    maxSizeBytes: 25 * 1024 * 1024,
  },
};

// Validación de configuración requerida
export function validateConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridos');
    process.exit(1);
  }
  if (!N8N_WEBHOOK_URL) {
    console.warn('⚠️  N8N_WEBHOOK_URL no configurado');
  }
}
