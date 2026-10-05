import { describe, expect, it } from 'vitest';

import type { SerializedIntegrationEvent } from '../../domain/events/integration-event.js';
import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import { OutboxMessageEntity } from '../entities/outbox-message.entity.js';
import { OutboxMessageMapper } from './outbox-message.mapper.js';

describe('OutboxMessageMapper', () => {
  const payload: SerializedIntegrationEvent<unknown> = {
    eventId: '0192f291-27dd-7d3f-8071-5f8685deef01',
    eventType: 'WalletBalanceChanged',
    aggregateId: '0192f291-27dd-7d3f-8071-5f8685deef02',
    correlationId: 'correlation-123',
    occurredAt: '2026-10-04T10:00:00.000Z',
    version: 1,
    data: {
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef02',
      transactionId: '0192f291-27dd-7d3f-8071-5f8685deef03',
    },
  };

  it('should convert OutboxMessageEntity to domain', () => {
    const entity = new OutboxMessageEntity();

    entity.id = '0192f291-27dd-7d3f-8071-5f8685deef01';
    entity.aggregateId = '0192f291-27dd-7d3f-8071-5f8685deef02';
    entity.eventType = 'WalletBalanceChanged';
    entity.payload = payload;
    entity.occurredAt = new Date('2026-10-04T10:00:00.000Z');
    entity.attempts = 2;
    entity.nextAttemptAt = new Date('2026-10-04T10:01:00.000Z');

    const message = OutboxMessageMapper.toDomain(entity);

    expect(message.id).toBe(entity.id);
    expect(message.aggregateId).toBe(entity.aggregateId);
    expect(message.eventType).toBe('WalletBalanceChanged');
    expect(message.payload).toEqual(payload);
    expect(message.occurredAt).toEqual(entity.occurredAt);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt).toEqual(entity.nextAttemptAt);
    expect(message.publishedAt).toBeUndefined();
  });

  it('should convert OutboxMessage domain to persistence', () => {
    const occurredAt = new Date('2026-10-04T10:00:00.000Z');

    const message = OutboxMessage.rehydrate({
      id: '0192f291-27dd-7d3f-8071-5f8685deef01',
      aggregateId: '0192f291-27dd-7d3f-8071-5f8685deef02',
      eventType: 'WalletBalanceChanged',
      payload,
      occurredAt,
      attempts: 0,
    });

    const entity = OutboxMessageMapper.toPersistence(message);

    expect(entity).toBeInstanceOf(OutboxMessageEntity);

    expect(entity.id).toBe(message.id);
    expect(entity.aggregateId).toBe(message.aggregateId);
    expect(entity.eventType).toBe(message.eventType);
    expect(entity.payload).toEqual(payload);
    expect(entity.occurredAt).toEqual(occurredAt);
    expect(entity.attempts).toBe(0);
    expect(entity.nextAttemptAt).toBeUndefined();
    expect(entity.publishedAt).toBeUndefined();
  });

  it('should preserve retry and published state during persistence round-trip', () => {
    const nextAttemptAt = new Date('2026-10-04T10:01:00.000Z');
    const publishedAt = new Date('2026-10-04T10:02:00.000Z');

    const message = OutboxMessage.rehydrate({
      id: '0192f291-27dd-7d3f-8071-5f8685deef01',
      aggregateId: '0192f291-27dd-7d3f-8071-5f8685deef02',
      eventType: 'WalletBalanceChanged',
      payload,
      occurredAt: new Date('2026-10-04T10:00:00.000Z'),
      attempts: 3,
      nextAttemptAt,
      publishedAt,
    });

    const entity = OutboxMessageMapper.toPersistence(message);
    const restored = OutboxMessageMapper.toDomain(entity);

    expect(restored.id).toBe(message.id);
    expect(restored.payload).toEqual(payload);
    expect(restored.attempts).toBe(3);
    expect(restored.nextAttemptAt).toEqual(nextAttemptAt);
    expect(restored.publishedAt).toEqual(publishedAt);
  });
});
