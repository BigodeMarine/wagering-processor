import { describe, expect, it } from 'vitest';

import { InboxMessage } from '../../domain/messaging/inbox-message.js';
import { InboxMessageEntity } from '../entities/inbox-message.entity.js';
import { InboxMessageMapper } from './inbox-message.mapper.js';

describe('InboxMessageMapper', () => {
  it('should convert InboxMessageEntity to domain', () => {
    const entity = new InboxMessageEntity();

    entity.consumerName = 'wager-transaction-consumer';
    entity.messageId = 'msg-123';
    entity.payloadHash = 'payload-hash';
    entity.receivedAt = new Date('2026-10-04T10:00:00.000Z');
    entity.processedAt = new Date('2026-10-04T10:00:01.000Z');

    const message = InboxMessageMapper.toDomain(entity);

    expect(message.consumerName).toBe('wager-transaction-consumer');
    expect(message.messageId).toBe('msg-123');
    expect(message.payloadHash).toBe('payload-hash');
    expect(message.receivedAt).toEqual(entity.receivedAt);
    expect(message.processedAt).toEqual(entity.processedAt);
    expect(message.isProcessed()).toBe(true);
  });

  it('should convert InboxMessage domain to persistence', () => {
    const receivedAt = new Date('2026-10-04T10:00:00.000Z');

    const message = InboxMessage.receive({
      consumerName: 'wager-transaction-consumer',
      messageId: 'msg-123',
      payloadHash: 'payload-hash',
      receivedAt,
    });

    const entity = InboxMessageMapper.toPersistence(message);

    expect(entity).toBeInstanceOf(InboxMessageEntity);

    expect(entity.consumerName).toBe('wager-transaction-consumer');
    expect(entity.messageId).toBe('msg-123');
    expect(entity.payloadHash).toBe('payload-hash');
    expect(entity.receivedAt).toEqual(receivedAt);
    expect(entity.processedAt).toBeUndefined();
  });

  it('should preserve processed state during persistence round-trip', () => {
    const message = InboxMessage.receive({
      consumerName: 'wager-transaction-consumer',
      messageId: 'msg-123',
      payloadHash: 'payload-hash',
      receivedAt: new Date('2026-10-04T10:00:00.000Z'),
    });

    const processedAt = new Date('2026-10-04T10:00:01.000Z');

    message.markProcessed(processedAt);

    const entity = InboxMessageMapper.toPersistence(message);
    const restored = InboxMessageMapper.toDomain(entity);

    expect(entity.consumerName).toBe('wager-transaction-consumer');
    expect(entity.messageId).toBe('msg-123');
    expect(entity.processedAt).toEqual(processedAt);

    expect(restored.consumerName).toBe(message.consumerName);
    expect(restored.messageId).toBe(message.messageId);
    expect(restored.isProcessed()).toBe(true);
    expect(restored.processedAt).toEqual(processedAt);
  });
});
