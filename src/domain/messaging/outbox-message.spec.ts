import { describe, expect, it } from 'vitest';
import { OutboxMessage } from './outbox-message.js';
import { WagerTransactionKind } from '../wagering/wager-transaction-kind.js';
import { WagerTransactionProcessed } from '../events/wager-transaction-processed.js';

describe('OutboxMessage', () => {
  const occurredAt = new Date('2026-01-01T10:00:00.000Z');

  function createEvent(): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: 'event-1',
      aggregateId: 'transaction-1',
      correlationId: 'correlation-1',
      causationId: 'message-1',
      occurredAt,
      data: {
        transactionId: 'transaction-1',
        providerId: 'provider-a',
        externalTransactionId: 'external-transaction-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });
  }
  it('should enqueue a new pending message', () => {
    const message = OutboxMessage.enqueue(createEvent());

    expect(message.id).toBe('event-1');
    expect(message.aggregateId).toBe('transaction-1');
    expect(message.eventType).toBe('WagerTransactionProcessed');
    expect(message.payload).toEqual({
      eventId: 'event-1',
      eventType: 'WagerTransactionProcessed',
      aggregateId: 'transaction-1',
      correlationId: 'correlation-1',
      causationId: 'message-1',
      occurredAt: '2026-01-01T10:00:00.000Z',
      version: 1,
      data: {
        transactionId: 'transaction-1',
        providerId: 'provider-a',
        externalTransactionId: 'external-transaction-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });
    expect(message.occurredAt).toEqual(occurredAt);

    expect(message.attempts).toBe(0);
    expect(message.nextAttemptAt).toBeUndefined();
    expect(message.publishedAt).toBeUndefined();

    expect(message.isPending()).toBe(true);
  });

  it('should consider a new message immediately due', () => {
    const message = OutboxMessage.enqueue(createEvent());

    expect(message.isDue(occurredAt)).toBe(true);
  });

  it('should schedule the first retry after one second', () => {
    const message = OutboxMessage.enqueue(createEvent());

    const now = new Date('2026-01-01T10:01:00.000Z');

    message.scheduleRetry(now);

    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt).toEqual(new Date('2026-01-01T10:01:01.000Z'));
  });

  it('should apply exponential backoff between retries', () => {
    const message = OutboxMessage.enqueue(createEvent());

    const firstFailure = new Date('2026-01-01T10:01:00.000Z');
    message.scheduleRetry(firstFailure);

    const secondFailure = new Date('2026-01-01T10:02:00.000Z');
    message.scheduleRetry(secondFailure);

    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt).toEqual(new Date('2026-01-01T10:02:02.000Z'));

    const thirdFailure = new Date('2026-01-01T10:03:00.000Z');
    message.scheduleRetry(thirdFailure);

    expect(message.attempts).toBe(3);
    expect(message.nextAttemptAt).toEqual(new Date('2026-01-01T10:03:04.000Z'));
  });

  it('should cap retry delay at sixty seconds', () => {
    const message = OutboxMessage.enqueue(createEvent());

    const now = new Date('2026-01-01T10:01:00.000Z');

    for (let attempt = 0; attempt < 8; attempt += 1) {
      message.scheduleRetry(now);
    }

    expect(message.attempts).toBe(8);
    expect(message.nextAttemptAt).toEqual(new Date('2026-01-01T10:02:00.000Z'));
  });

  it('should only become due when nextAttemptAt is reached', () => {
    const message = OutboxMessage.enqueue(createEvent());

    const failureAt = new Date('2026-01-01T10:01:00.000Z');

    message.scheduleRetry(failureAt);

    expect(message.isDue(new Date('2026-01-01T10:01:00.999Z'))).toBe(false);

    expect(message.isDue(new Date('2026-01-01T10:01:01.000Z'))).toBe(true);
  });

  it('should mark a message as published', () => {
    const message = OutboxMessage.enqueue(createEvent());

    const failureAt = new Date('2026-01-01T10:01:00.000Z');
    message.scheduleRetry(failureAt);

    const publishedAt = new Date('2026-01-01T10:02:00.000Z');

    message.markPublished(publishedAt);

    expect(message.publishedAt).toEqual(publishedAt);
    expect(message.nextAttemptAt).toBeUndefined();
    expect(message.isPending()).toBe(false);
    expect(message.isDue(publishedAt)).toBe(false);
  });

  it('should preserve the first publishedAt and ignore retries after publication', () => {
    const message = OutboxMessage.enqueue(createEvent());

    const firstPublishedAt = new Date('2026-01-01T10:01:00.000Z');

    message.markPublished(firstPublishedAt);

    message.markPublished(new Date('2026-01-01T10:02:00.000Z'));

    message.scheduleRetry(new Date('2026-01-01T10:03:00.000Z'));

    expect(message.publishedAt).toEqual(firstPublishedAt);
    expect(message.attempts).toBe(0);
    expect(message.nextAttemptAt).toBeUndefined();
  });

  it('should rehydrate a persisted message', () => {
    const nextAttemptAt = new Date('2026-01-01T10:05:00.000Z');

    const message = OutboxMessage.rehydrate({
      id: 'event-1',
      aggregateId: 'transaction-1',
      eventType: 'WagerTransactionProcessed',
      payload: {
        eventId: 'event-1',
        eventType: 'WagerTransactionProcessed',
        aggregateId: 'transaction-1',
        correlationId: 'correlation-1',
        causationId: 'message-1',
        occurredAt: '2026-01-01T10:00:00.000Z',
        version: 1,
        data: {
          transactionId: 'transaction-1',
          providerId: 'provider-a',
          externalTransactionId: 'external-transaction-1',
          walletId: 'wallet-1',
          playerId: 'player-1',
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          money: {
            amount: '25.00',
            currency: 'BRL',
          },
        },
      },
      occurredAt,
      attempts: 3,
      nextAttemptAt,
    });

    expect(message.id).toBe('event-1');
    expect(message.attempts).toBe(3);
    expect(message.nextAttemptAt).toEqual(nextAttemptAt);
    expect(message.publishedAt).toBeUndefined();
    expect(message.isPending()).toBe(true);
  });
});
