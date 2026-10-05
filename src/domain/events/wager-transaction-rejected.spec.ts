import { describe, expect, it } from 'vitest';
import { FailureCode } from '../wagering/failure-code.js';
import { WagerTransactionKind } from '../wagering/wager-transaction-kind.js';
import { WagerTransactionRejected } from './wager-transaction-rejected.js';

describe('WagerTransactionRejected', () => {
  const occurredAt = new Date('2026-07-29T15:00:00.000Z');

  it('should create a version 1 WagerTransactionRejected event', () => {
    const event = new WagerTransactionRejected({
      eventId: 'event-123',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      occurredAt,
      data: {
        transactionId: 'transaction-123',
        providerId: 'provider-a',
        externalTransactionId: 'transaction-123',
        walletId: 'wallet-123',
        playerId: 'player-123',
        roundId: 'round-987',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '80.00',
          currency: 'BRL',
        },
        failureCode: FailureCode.InsufficientBalance,
      },
    });

    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.version).toBe(1);
    expect(event.aggregateId).toBe('transaction-123');

    expect(event.data.failureCode).toBe(FailureCode.InsufficientBalance);
  });

  it('should serialize the complete rejected event envelope', () => {
    const event = new WagerTransactionRejected({
      eventId: 'event-123',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt,
      data: {
        transactionId: 'transaction-123',
        providerId: 'provider-a',
        externalTransactionId: 'transaction-123',
        walletId: 'wallet-123',
        playerId: 'player-123',
        roundId: 'round-987',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '80.00',
          currency: 'BRL',
        },
        failureCode: FailureCode.InsufficientBalance,
      },
    });

    expect(event.toJSON()).toEqual({
      eventId: 'event-123',
      eventType: 'WagerTransactionRejected',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt: '2026-07-29T15:00:00.000Z',
      version: 1,
      data: {
        transactionId: 'transaction-123',
        providerId: 'provider-a',
        externalTransactionId: 'transaction-123',
        walletId: 'wallet-123',
        playerId: 'player-123',
        roundId: 'round-987',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '80.00',
          currency: 'BRL',
        },
        failureCode: FailureCode.InsufficientBalance,
      },
    });
  });

  it('should expose only the stable failure code without human error message', () => {
    const event = new WagerTransactionRejected({
      eventId: 'event-123',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      occurredAt,
      data: {
        transactionId: 'transaction-123',
        providerId: 'provider-a',
        externalTransactionId: 'transaction-123',
        walletId: 'wallet-123',
        playerId: 'player-123',
        roundId: 'round-987',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '80.00',
          currency: 'BRL',
        },
        failureCode: FailureCode.InsufficientBalance,
      },
    });

    const serialized = event.toJSON();

    expect(serialized.data.failureCode).toBe(FailureCode.InsufficientBalance);

    expect(serialized.data).not.toHaveProperty('message');
    expect(serialized.data).not.toHaveProperty('status');
    expect(serialized.data).not.toHaveProperty('balance');
  });
});
