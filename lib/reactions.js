import { HUMAN_BEHAVIOR_CONFIG } from '../config/index.js';
import { randomBetween, safeSleep } from './utils.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SISTEMA DE REACCIONES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Determina si se debe reaccionar a un mensaje y con qué emoji
 */
export function shouldReact(messageType, messageText) {
  const config = HUMAN_BEHAVIOR_CONFIG.reactions;
  
  if (!config.enabled) return null;
  if (!config.reactToTypes.includes(messageType)) return null;
  if (Math.random() > config.probability) return null;
  
  const text = (messageText || '').toLowerCase();
  let emojiPool;
  
  // Elegir pool de emojis según contexto
  if (messageType === 'image' || messageType === 'video' ||
      text.includes('gracias') || text.includes('genial') || 
      text.includes('perfecto') || text.includes('excelente')) {
    emojiPool = config.positiveEmojis;
  } else {
    emojiPool = config.acknowledgmentEmojis;
  }
  
  return emojiPool[Math.floor(Math.random() * emojiPool.length)];
}

/**
 * Envía una reacción a un mensaje
 */
export async function sendReaction(message, emoji) {
  try {
    const config = HUMAN_BEHAVIOR_CONFIG.reactions;
    const [min, max] = config.delayBeforeReactMs;
    
    // Pequeño delay antes de reaccionar
    await safeSleep(randomBetween(min, max), 2000);
    await message.react(emoji);
    
    console.log(`   ${emoji} Reacción enviada`);
    return true;
  } catch (error) {
    return false;
  }
}
