import type { InboxMessage } from '../../../domain/messaging/inbox-message.js';

/**
 * Contrato de persistência para mensagens recebidas pelos consumers.
 * A Inbox fornece deduplicação persistente por
 * (consumerName, messageId).
 */
export interface InboxRepository {
  /**
   * Busca uma mensagem previamente recebida pelo consumer.
   */
  findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null>;

  /**
   * Persiste uma nova mensagem ou seu estado de processamento.
   */
  save(message: InboxMessage): Promise<void>;
}