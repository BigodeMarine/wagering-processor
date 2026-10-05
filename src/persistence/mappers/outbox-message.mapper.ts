import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import { OutboxMessageEntity } from '../entities/outbox-message.entity.js';

/**
 * Converte OutboxMessage entre domínio e persistência.
 */
export class OutboxMessageMapper {
  /**
   * Reconstrói a mensagem de Outbox a partir do estado persistido.
   */
  static toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
      publishedAt: entity.publishedAt,
      claimedBy: entity.claimedBy,
      claimUntil: entity.claimUntil,
    });
  }

  /**
   * Converte uma nova mensagem de domínio para persistência.
   */
  static toPersistence(message: OutboxMessage): OutboxMessageEntity {
    const entity = new OutboxMessageEntity();

    entity.id = message.id;
    entity.aggregateId = message.aggregateId;
    entity.eventType = message.eventType;
    entity.payload = message.payload;
    entity.occurredAt = message.occurredAt;

    this.updatePersistence(entity, message);

    return entity;
  }

  /**
   * Atualiza uma entity existente com o estado mutável da Outbox.
   *
   * É utilizado pelo publisher para persistir claim, retry
   * e confirmação de publicação sem tentar inserir novamente
   * a mesma mensagem.
   */
  static updatePersistence(
    entity: OutboxMessageEntity,
    message: OutboxMessage,
  ): void {
    entity.attempts = message.attempts;
    entity.nextAttemptAt = message.nextAttemptAt;
    entity.publishedAt = message.publishedAt;
    entity.claimedBy = message.claimedBy;
    entity.claimUntil = message.claimUntil;
  }
}
