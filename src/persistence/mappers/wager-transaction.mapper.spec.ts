import { describe, expect, it } from 'vitest';

import { Money } from '../../domain/money/money.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../domain/wagering/wager-transaction-status.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';
import { WagerTransactionMapper } from './wager-transaction.mapper.js';
import { rel } from '@mikro-orm/core';
import { WalletEntity } from '../entities/wallet.entity.js';

describe('WagerTransactionMapper', () => {
  it('should convert WagerTransactionEntity to domain', () => {
    const entity = new WagerTransactionEntity();

    entity.id = '0192f291-27dd-7d3f-8071-5f8685deef37';
    entity.providerId = 'provider-a';
    entity.externalTransactionId = 'transaction-123';
    entity.idempotencyKey = 'provider-a:transaction-123';
    entity.payloadHash = 'payload-hash';
    entity.wallet = rel(WalletEntity, '0192f291-27dd-7d3f-8071-5f8685deef38');
    entity.playerId = '0192f291-27dd-7d3f-8071-5f8685deef39';
    entity.roundId = 'round-987';
    entity.gameId = 'fortune-chimp';
    entity.kind = WagerTransactionKind.Bet;
    entity.amount = '25.10';
    entity.currency = 'BRL';
    entity.status = WagerTransactionStatus.Processed;
    entity.createdAt = new Date('2026-10-04T10:00:00.000Z');
    entity.processedAt = new Date('2026-10-04T10:00:01.000Z');

    const transaction = WagerTransactionMapper.toDomain(entity);

    expect(transaction.id).toBe(entity.id);
    expect(transaction.providerId).toBe('provider-a');
    expect(transaction.externalTransactionId).toBe('transaction-123');
    expect(transaction.kind).toBe(WagerTransactionKind.Bet);
    expect(transaction.money.toString()).toBe('25.10');
    expect(transaction.money.currency).toBe('BRL');
    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.createdAt).toEqual(entity.createdAt);
    expect(transaction.processedAt).toEqual(entity.processedAt);
  });

  it('should preserve a pending reference transaction', () => {
    const entity = new WagerTransactionEntity();

    entity.id = '0192f291-27dd-7d3f-8071-5f8685deef37';
    entity.providerId = 'provider-a';
    entity.externalTransactionId = 'refund-123';
    entity.idempotencyKey = 'provider-a:refund-123';
    entity.payloadHash = 'payload-hash';
    entity.wallet = rel(WalletEntity, '0192f291-27dd-7d3f-8071-5f8685deef38');
    entity.playerId = '0192f291-27dd-7d3f-8071-5f8685deef39';
    entity.roundId = 'round-987';
    entity.gameId = 'fortune-chimp';
    entity.kind = WagerTransactionKind.Refund;
    entity.amount = '25.00';
    entity.currency = 'BRL';
    entity.referenceExternalTransactionId = 'bet-123';
    entity.status = WagerTransactionStatus.PendingReference;
    entity.createdAt = new Date('2026-10-04T10:00:00.000Z');

    const transaction = WagerTransactionMapper.toDomain(entity);

    expect(transaction.kind).toBe(WagerTransactionKind.Refund);
    expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(transaction.referenceExternalTransactionId).toBe('bet-123');
    expect(transaction.referenceTransactionId).toBeUndefined();
    expect(transaction.processedAt).toBeUndefined();
  });

  it('should preserve resolved reference and failure code', () => {
    const entity = new WagerTransactionEntity();

    entity.id = '0192f291-27dd-7d3f-8071-5f8685deef37';
    entity.providerId = 'provider-a';
    entity.externalTransactionId = 'rollback-123';
    entity.idempotencyKey = 'provider-a:rollback-123';
    entity.payloadHash = 'payload-hash';
    entity.wallet = rel(WalletEntity, '0192f291-27dd-7d3f-8071-5f8685deef38');
    entity.playerId = '0192f291-27dd-7d3f-8071-5f8685deef39';
    entity.roundId = 'round-987';
    entity.gameId = 'fortune-chimp';
    entity.kind = WagerTransactionKind.Rollback;
    entity.amount = '25.00';
    entity.currency = 'BRL';
    entity.referenceExternalTransactionId = 'win-123';
    entity.referenceTransactionId = '0192f291-27dd-7d3f-8071-5f8685deef40';
    entity.status = WagerTransactionStatus.Rejected;
    entity.failureCode = FailureCode.ReferenceMismatch;
    entity.createdAt = new Date('2026-10-04T10:00:00.000Z');

    const transaction = WagerTransactionMapper.toDomain(entity);

    expect(transaction.referenceExternalTransactionId).toBe('win-123');
    expect(transaction.referenceTransactionId).toBe(
      '0192f291-27dd-7d3f-8071-5f8685deef40',
    );
    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe(FailureCode.ReferenceMismatch);
  });

  it('should preserve monetary value during persistence round-trip', () => {
    const original = WagerTransaction.create({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
      idempotencyKey: 'provider-a:transaction-123',
      payloadHash: 'payload-hash',
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef38',
      playerId: '0192f291-27dd-7d3f-8071-5f8685deef39',
      roundId: 'round-987',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({
        amount: '25.10',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-10-04T10:00:00.000Z'),
    });

    const entity = WagerTransactionMapper.toPersistence(original);
    const restored = WagerTransactionMapper.toDomain(entity);

    expect(entity).toBeInstanceOf(WagerTransactionEntity);

    expect(entity.amount).toBe('25.10');
    expect(entity.currency).toBe('BRL');

    expect(restored.money.toString()).toBe('25.10');
    expect(restored.money.equals(original.money)).toBe(true);

    expect(restored.id).toBe(original.id);
    expect(restored.kind).toBe(original.kind);
    expect(restored.status).toBe(WagerTransactionStatus.Pending);
  });

  it('should persist the resulting balance as a string', () => {
    const transaction = WagerTransaction.create({
      id: 'transaction-1',
      providerId: 'provider-1',
      externalTransactionId: 'external-1',
      idempotencyKey: 'provider-1:external-1',
      payloadHash: 'hash-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({
        amount: '25.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
    });

    transaction.markProcessed(
      undefined,
      Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      new Date('2026-01-01T10:01:00.000Z'),
    );

    const entity = WagerTransactionMapper.toPersistence(transaction);

    expect(entity.resultingBalance).toBe('75.00');
    expect(typeof entity.resultingBalance).toBe('string');
  });
  it('should restore the resulting balance from persistence', () => {
    const transaction = WagerTransaction.rehydrate({
      id: 'transaction-1',
      providerId: 'provider-1',
      externalTransactionId: 'external-1',
      idempotencyKey: 'provider-1:external-1',
      payloadHash: 'hash-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({
        amount: '25.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      status: WagerTransactionStatus.Processed,
      processedAt: new Date('2026-01-01T10:01:00.000Z'),
      resultingBalance: Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
    });

    const entity = WagerTransactionMapper.toPersistence(transaction);
    const restored = WagerTransactionMapper.toDomain(entity);

    expect(restored.resultingBalance?.toJSON()).toEqual({
      amount: '75.00',
      currency: 'BRL',
    });
  });
});
