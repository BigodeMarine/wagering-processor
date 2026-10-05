import { InboxMessage } from '../../domain/messaging/inbox-message.js';
import { InboxMessageEntity } from '../entities/inbox-message.entity.js';

/**
 * Converte InboxMessage entre domínio e persistência.
 */
export class InboxMessageMapper {
  /**
   * Reconstrói a mensagem de domínio a partir do estado persistido.
   */
  static toDomain(entity: InboxMessageEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: entity.messageId,
      consumerName: entity.consumerName,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt,
    });
  }

  /**
   * Converte a mensagem de domínio para sua representação persistível.
   */
  static toPersistence(message: InboxMessage): InboxMessageEntity {
    const entity = new InboxMessageEntity();

    entity.messageId = message.messageId;
    entity.consumerName = message.consumerName;
    entity.payloadHash = message.payloadHash;
    entity.receivedAt = message.receivedAt;
    entity.processedAt = message.processedAt;

    return entity;
  }
  /**
   * Atualiza uma entidade já gerenciada pelo MikroORM com o estado
   * atual da mensagem de domínio.
   *
   * A identidade da Inbox é imutável e definida por
   * (consumerName, messageId). Portanto, somente o estado mutável
   * necessário ao processamento é atualizado.
   */
  static updatePersistence(
    entity: InboxMessageEntity,
    message: InboxMessage,
  ): void {
    entity.payloadHash = message.payloadHash;
    entity.receivedAt = message.receivedAt;
    entity.processedAt = message.processedAt;
  }
}
