import { describe, expect, it } from 'vitest';
import { WagerTransactionKind } from '../wagering/wager-transaction-kind.js';
import { WagerTransactionProcessed } from './wager-transaction-processed.js';

describe('WagerTransactionProcessed', () => {
  const occurredAt = new Date('2026-07-29T15:00:00.000Z');

  it('should create a version 1 WagerTransactionProcessed event', () => {
    const event = new WagerTransactionProcessed({
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
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });

    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.version).toBe(1);
    expect(event.aggregateId).toBe('transaction-123');

    expect(event.data).toEqual({
      transactionId: 'transaction-123',
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
      walletId: 'wallet-123',
      playerId: 'player-123',
      roundId: 'round-987',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: {
        amount: '25.00',
        currency: 'BRL',
      },
    });
  });

  it('should serialize the complete integration event envelope', () => {
    const event = new WagerTransactionProcessed({
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
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });

    expect(event.toJSON()).toEqual({
      eventId: 'event-123',
      eventType: 'WagerTransactionProcessed',
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
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });
  });

  it('should support LOSS as a processed transaction event', () => {
    const event = new WagerTransactionProcessed({
      eventId: 'event-loss',
      aggregateId: 'transaction-loss',
      correlationId: 'correlation-123',
      occurredAt,
      data: {
        transactionId: 'transaction-loss',
        providerId: 'provider-a',
        externalTransactionId: 'loss-123',
        walletId: 'wallet-123',
        playerId: 'player-123',
        roundId: 'round-987',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Loss,
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
      },
    });

    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.data.kind).toBe(WagerTransactionKind.Loss);
  });
});
