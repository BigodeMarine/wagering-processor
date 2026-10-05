import { describe, expect, it } from 'vitest';

import { WagerTransactionKind } from '../wagering/wager-transaction-kind.js';
import { WagerTransactionPendingReference } from './wager-transaction-pending-reference.js';

describe('WagerTransactionPendingReference', () => {
  const occurredAt = new Date('2026-07-29T15:00:00.000Z');

  function createEvent() {
    return new WagerTransactionPendingReference({
      eventId: 'event-123',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt,
      data: {
        transactionId: 'transaction-123',
        providerId: 'provider-a',
        externalTransactionId: 'refund-123',
        walletId: 'wallet-123',
        playerId: 'player-123',
        roundId: 'round-987',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Refund,
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
        referenceExternalTransactionId: 'bet-123',
      },
    });
  }

  it('creates a version 1 pending reference event', () => {
    const event = createEvent();

    expect(event.eventType).toBe('WagerTransactionPendingReference');
    expect(event.version).toBe(1);
    expect(event.aggregateId).toBe('transaction-123');

    expect(event.data.referenceExternalTransactionId).toBe('bet-123');

    expect(event.data.kind).toBe(WagerTransactionKind.Refund);
  });

  it('serializes the complete integration event envelope', () => {
    const event = createEvent();

    expect(event.toJSON()).toEqual({
      eventId: 'event-123',
      eventType: 'WagerTransactionPendingReference',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt: '2026-07-29T15:00:00.000Z',
      version: 1,
      data: {
        transactionId: 'transaction-123',
        providerId: 'provider-a',
        externalTransactionId: 'refund-123',
        walletId: 'wallet-123',
        playerId: 'player-123',
        roundId: 'round-987',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Refund,
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
        referenceExternalTransactionId: 'bet-123',
      },
    });
  });

  it('keeps retry policy and failure information out of the event payload', () => {
    const event = createEvent();
    const serialized = event.toJSON();

    expect(serialized.data.money).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });

    expect(serialized.data).not.toHaveProperty('status');
    expect(serialized.data).not.toHaveProperty('failureCode');
    expect(serialized.data).not.toHaveProperty('retryCount');
    expect(serialized.data).not.toHaveProperty('nextRetryAt');
    expect(serialized.data).not.toHaveProperty('message');
  });
});
