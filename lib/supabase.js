import { createClient } from '@supabase/supabase-js';
import { 
  SUPABASE_URL, 
  SUPABASE_SERVICE_ROLE_KEY, 
  WORKER_ID, 
  PORT,
  HUMAN_BEHAVIOR_CONFIG 
} from '../config/index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTE SUPABASE
// ═══════════════════════════════════════════════════════════════════════════════

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ═══════════════════════════════════════════════════════════════════════════════
// ORQUESTADOR SUPABASE
// ═══════════════════════════════════════════════════════════════════════════════

class SupabaseOrchestrator {
  constructor() {
    this.messagesProcessed = 0;
    this.heartbeatInterval = null;
    this.cleanupInterval = null;
  }

  async start() {
    console.log(`🔗 [${WORKER_ID}] Iniciando orquestador Supabase...`);
    await this.sendHeartbeat();
    this.heartbeatInterval = setInterval(
      () => this.sendHeartbeat(), 
      HUMAN_BEHAVIOR_CONFIG.multiWorker.heartbeatIntervalMs
    );
    this.cleanupInterval = setInterval(
      () => this.cleanup(), 
      HUMAN_BEHAVIOR_CONFIG.multiWorker.cleanupIntervalMs
    );
    console.log(`✅ [${WORKER_ID}] Orquestador iniciado`);
  }

  async stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    try {
      await supabase.from('wa_workers')
        .update({ status: 'inactive', updated_at: new Date().toISOString() })
        .eq('worker_id', WORKER_ID);
    } catch (e) {}
    console.log(`🛑 [${WORKER_ID}] Orquestador detenido`);
  }

  async sendHeartbeat() {
    try {
      await supabase.rpc('worker_heartbeat', { 
        p_worker_id: WORKER_ID, 
        p_port: PORT 
      });
    } catch (error) {
      console.error(`⚠️ [${WORKER_ID}] Heartbeat error:`, error.message);
    }
  }

  async tryClaimMessage(messageId, phone) {
    const config = HUMAN_BEHAVIOR_CONFIG.multiWorker;
    this.messagesProcessed++;
    const shouldTryCrossWorker = Math.random() < config.crossWorkerProbability ||
      this.messagesProcessed % config.crossWorkerEveryNMessages === 0;

    try {
      const { data, error } = await supabase.rpc('try_claim_message', {
        p_message_id: messageId, 
        p_phone: phone,
        p_worker_id: WORKER_ID, 
        p_allow_cross_worker: shouldTryCrossWorker
      });
      
      if (error) return { shouldProcess: false, reason: 'db_error' };
      
      return {
        shouldProcess: data.should_process || false,
        isCrossWorker: data.is_cross_worker || false,
        assignedWorker: data.assigned_worker,
        reason: data.reason
      };
    } catch (error) {
      return { shouldProcess: false, reason: 'exception' };
    }
  }

  async markProcessed(messageId) {
    try {
      await supabase.rpc('mark_message_processed', { 
        p_message_id: messageId, 
        p_worker_id: WORKER_ID 
      });
    } catch (error) {}
  }

  async cleanup() {
    try {
      const { data } = await supabase.rpc('cleanup_old_data');
      if (data && (data.locks_deleted > 0 || data.workers_marked_dead > 0)) {
        console.log(`🧹 [${WORKER_ID}] Limpieza: locks=${data.locks_deleted}, dead=${data.workers_marked_dead}`);
      }
    } catch (error) {}
  }

  async getStats() {
    try {
      const { data } = await supabase.rpc('get_orchestration_stats');
      return data;
    } catch (error) {
      return null;
    }
  }
}

// Singleton
export const orchestrator = new SupabaseOrchestrator();
