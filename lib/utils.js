import { HUMAN_BEHAVIOR_CONFIG, TIMEZONE } from '../config/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// UTILIDADES GENERALES
// ═══════════════════════════════════════════════════════════════════════════════

export function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function gaussianRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(0, num * stdDev + mean);
}

export function applyJitter(baseValue, jitterPercent) {
  const jitter = baseValue * jitterPercent;
  return baseValue + gaussianRandom(0, jitter);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function safeSleep(ms, maxMs = 60000) {
  return new Promise(resolve => setTimeout(resolve, Math.min(ms, maxMs)));
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUNCIONES DE TIEMPO (COSTA RICA)
// ═══════════════════════════════════════════════════════════════════════════════

export function getCostaRicaHour() {
  const now = new Date();
  const crTime = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  return crTime.getHours();
}

export function isSleepTime() {
  if (!HUMAN_BEHAVIOR_CONFIG.schedule.enabled) return false;
  const hour = getCostaRicaHour();
  const { sleepHoursStart, sleepHoursEnd } = HUMAN_BEHAVIOR_CONFIG.schedule;
  return hour >= sleepHoursStart && hour < sleepHoursEnd;
}

export function isNightTime() {
  if (!HUMAN_BEHAVIOR_CONFIG.schedule.enabled) return false;
  const hour = getCostaRicaHour();
  const { nightHoursStart, nightHoursEnd } = HUMAN_BEHAVIOR_CONFIG.schedule;
  return hour >= nightHoursStart || hour < nightHoursEnd;
}

export function getTimeOfDayFactor() {
  if (isSleepTime()) return HUMAN_BEHAVIOR_CONFIG.schedule.sleepSlowdownFactor;
  if (isNightTime()) return HUMAN_BEHAVIOR_CONFIG.schedule.nightSlowdownFactor;
  return 1.0;
}

export async function applySleepDelay() {
  if (isSleepTime()) {
    const [min, max] = HUMAN_BEHAVIOR_CONFIG.schedule.sleepInitialDelayMs;
    const delay = randomBetween(min, max);
    const variation = randomBetween(-5000, 10000);
    const finalDelay = Math.max(10000, delay + variation);
    console.log(`   😴 Horario sueño CR - delay: ${(finalDelay/1000).toFixed(1)}s`);
    await safeSleep(finalDelay, 60000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CÁLCULOS DE TIEMPO DE COMPORTAMIENTO HUMANO
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateReadingTime(messageText) {
  const config = HUMAN_BEHAVIOR_CONFIG.reading;
  let readingTime = config.baseTimeMs + ((messageText?.length || 0) * config.msPerCharacter);
  readingTime = Math.min(readingTime, config.maxReadingTimeMs);
  readingTime = applyJitter(readingTime, config.jitterPercent);
  readingTime *= getTimeOfDayFactor();
  return Math.floor(readingTime);
}

export function calculateMediaViewTime(mediaType) {
  const config = HUMAN_BEHAVIOR_CONFIG.reading;
  let range;
  switch (mediaType) {
    case 'image': range = config.imageViewTimeMs; break;
    case 'video': range = config.videoViewTimeMs; break;
    case 'audio': range = config.audioListenTimeMs; break;
    default: range = [1000, 2000];
  }
  return randomBetween(range[0], range[1]) * getTimeOfDayFactor();
}

export function calculateTypingTime(responseText) {
  const config = HUMAN_BEHAVIOR_CONFIG.typing;
  let typingTime = (responseText?.length || 0) * config.msPerCharacter;
  typingTime = Math.max(typingTime, config.minTypingTimeMs);
  typingTime = Math.min(typingTime, config.maxTypingTimeMs);
  typingTime = applyJitter(typingTime, config.jitterPercent);
  typingTime *= getTimeOfDayFactor();
  return Math.min(Math.floor(typingTime), config.absoluteMaxTypingMs);
}

export function calculateMinimumResponseTime(responseText) {
  const config = HUMAN_BEHAVIOR_CONFIG.response;
  const charCount = responseText?.length || 0;
  let minTime;
  if (charCount < 50) minTime = config.shortMessageMinMs;
  else if (charCount < 200) minTime = config.mediumMessageMinMs;
  else minTime = config.longMessageMinMs;
  minTime = Math.max(minTime, config.absoluteMinimumMs);
  const [jitterMin, jitterMax] = config.jitterRangeMs;
  minTime += randomBetween(jitterMin, jitterMax);
  minTime *= getTimeOfDayFactor();
  return Math.floor(minTime);
}

export function shouldQuoteMessage(originalMessageText) {
  const config = HUMAN_BEHAVIOR_CONFIG.replyBehavior;
  const msgLength = originalMessageText?.length || 0;
  if (msgLength > config.quoteIfMessageLongerThan) return true;
  if (msgLength < config.neverQuoteIfShorterThan) return false;
  return Math.random() < config.quoteMessageProbability;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILIDADES DE WHATSAPP
// ═══════════════════════════════════════════════════════════════════════════════

export function normalizeIdentifier(from) {
  if (!from) return null;
  if (from.includes('@g.us') || from.includes('@broadcast')) return null;
  return from.replace('@c.us', '').replace('@lid', '').replace('whatsapp:', '');
}

export async function getRealPhoneNumber(message) {
  try {
    const contact = await message.getContact();
    if (contact.number) {
      let phone = contact.number.replace(/\D/g, '');
      return phone.startsWith('+') ? phone : '+' + phone;
    }
    if (contact.id?.user) {
      let phone = contact.id.user.replace(/\D/g, '');
      return phone.startsWith('+') ? phone : '+' + phone;
    }
    return '+' + normalizeIdentifier(message.from);
  } catch (error) {
    return '+' + normalizeIdentifier(message.from);
  }
}

export function formatPhoneForDisplay(phone) {
  if (!phone) return null;
  let p = phone.replace(/\D/g, '');
  return p.startsWith('+') ? p : '+' + p;
}

export function phoneToWhatsAppId(phone) {
  return phone.replace('+', '').replace(/\D/g, '') + '@c.us';
}

export async function sendSeenRobust(chat, message) {
  const config = HUMAN_BEHAVIOR_CONFIG.seen;
  for (let attempt = 1; attempt <= config.retryAttempts + 1; attempt++) {
    try {
      await chat.sendSeen();
      return true;
    } catch (error) {
      if (attempt <= config.retryAttempts) {
        await sleep(config.retryDelayMs);
        try {
          if (typeof message.markAsRead === 'function') {
            await message.markAsRead();
            return true;
          }
        } catch (_) {}
      }
    }
  }
  return false;
}
