import type { OutboxMessage } from '../../../domain/messaging/outbox-message.js';

/**
 * Contrato de persistência para eventos armazenados na Transactional Outbox.
 *
 * A criação da mensagem ocorre dentro da mesma transação SQL
 * da operação financeira. A publicação é realizada posteriormente
 * por workers concorrentes.
 */
export interface OutboxRepository {
  /**
   * Persiste uma nova mensagem ou atualiza seu estado mutável.
   */
  save(message: OutboxMessage): Promise<void>;

  /**
   * Reserva atomicamente um lote de mensagens publicáveis.
   *
   * A implementação PostgreSQL utiliza FOR UPDATE SKIP LOCKED
   * para permitir múltiplos publishers concorrentes sem um
   * lock global.
   */
  claimPending(
    publisherId: string,
    now: Date,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<OutboxMessage[]>;
}
