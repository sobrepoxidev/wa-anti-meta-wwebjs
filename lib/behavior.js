import { HUMAN_BEHAVIOR_CONFIG } from '../config/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// VARIADOR DE COMPORTAMIENTO
// ═══════════════════════════════════════════════════════════════════════════════
// 
// Varía ligeramente el comportamiento cada N mensajes para que no sea
// perfectamente predecible y parezca más humano.
//
// ═══════════════════════════════════════════════════════════════════════════════

class BehaviorVariator {
  constructor() {
    this.messageCount = new Map();      // identifier → count
    this.currentVariation = new Map();  // identifier → variation factor
  }

  /**
   * Obtiene un factor de variación para un usuario
   * El factor varía cada N mensajes
   */
  getVariationFactor(identifier) {
    const count = this.messageCount.get(identifier) || 0;
    this.messageCount.set(identifier, count + 1);
    
    // Cada N mensajes, generar nueva variación
    if (count % HUMAN_BEHAVIOR_CONFIG.patterns.varyBehaviorEveryNMessages === 0) {
      const variationPercent = HUMAN_BEHAVIOR_CONFIG.patterns.behaviorVariationPercent;
      // Genera un factor entre 1-variationPercent y 1+variationPercent
      const variation = 1 + (Math.random() - 0.5) * 2 * variationPercent;
      this.currentVariation.set(identifier, variation);
    }
    
    return this.currentVariation.get(identifier) || 1.0;
  }

  /**
   * Resetea las estadísticas de un usuario
   */
  reset(identifier) {
    this.messageCount.delete(identifier);
    this.currentVariation.delete(identifier);
  }

  /**
   * Obtiene estadísticas
   */
  getStats() {
    return {
      trackedUsers: this.messageCount.size,
      users: Array.from(this.messageCount.entries()).map(([id, count]) => ({
        id: id.slice(-6),
        messages: count,
        variation: (this.currentVariation.get(id) || 1).toFixed(2)
      }))
    };
  }
}

// Singleton
export const behaviorVariator = new BehaviorVariator();
