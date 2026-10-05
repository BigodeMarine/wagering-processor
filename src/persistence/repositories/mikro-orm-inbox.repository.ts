import type { EntityManager } from '@mikro-orm/postgresql';
import type { InboxRepository } from '../../application/ports/repositories/inbox.repository.js';
import type { InboxMessage } from '../../domain/messaging/inbox-message.js';
import { InboxMessageEntity } from '../entities/inbox-message.entity.js';
import { InboxMessageMapper } from '../mappers/inbox-message.mapper.js';

/**
 * Implementação MikroORM do repositório de InboxMessage.
 * A Inbox fornece deduplicação persistente por
 * (consumerName, messageId).
 */
export class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Busca uma mensagem previamente recebida pelo consumer.
   */
  async findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null> {
    const entity = await this.em.findOne(InboxMessageEntity, {
      consumerName,
      messageId,
    });

    return entity ? InboxMessageMapper.toDomain(entity) : null;
  }

  /**
   * Persiste uma mensagem da Inbox ou seu estado de processamento.
   * O flush é controlado pela fronteira transacional.
   */
  async save(message: InboxMessage): Promise<void> {
    const existingEntity = await this.em.findOne(InboxMessageEntity, {
      consumerName: message.consumerName,
      messageId: message.messageId,
    });

    if (existingEntity) {
      InboxMessageMapper.updatePersistence(existingEntity, message);
      return;
    }

    const entity = InboxMessageMapper.toPersistence(message);

    this.em.persist(entity);
  }
}
