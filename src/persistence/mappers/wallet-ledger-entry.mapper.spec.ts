import { describe, expect, it } from 'vitest';

import { Money } from '../../domain/money/money.js';
import { LedgerDirection } from '../../domain/ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryMapper } from './wallet-ledger-entry.mapper.js';
import { WalletEntity } from '../entities/wallet.entity.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';

describe('WalletLedgerEntryMapper', () => {
  it('should convert WalletLedgerEntryEntity to domain', () => {
    const entity = new WalletLedgerEntryEntity();

    entity.id = '0192f291-27dd-7d3f-8071-5f8685deef37';
    entity.wallet = new WalletEntity();
    entity.wallet.id = '0192f291-27dd-7d3f-8071-5f8685deef38';

    entity.transaction = new WagerTransactionEntity();
    entity.transaction.id = '0192f291-27dd-7d3f-8071-5f8685deef39';
    entity.direction = LedgerDirection.Debit;
    entity.amount = '25.05';
    entity.currency = 'BRL';
    entity.balanceBefore = '100.10';
    entity.balanceAfter = '75.05';
    entity.createdAt = new Date('2026-10-04T10:00:00.000Z');

    const entry = WalletLedgerEntryMapper.toDomain(entity);

    expect(entry.id).toBe(entity.id);
    expect(entry.walletId).toBe(entity.wallet.id);
    expect(entry.transactionId).toBe(entity.transaction.id);

    expect(entry.direction).toBe(LedgerDirection.Debit);

    expect(entry.money.toString()).toBe('25.05');
    expect(entry.money.currency).toBe('BRL');

    expect(entry.balanceBefore.toString()).toBe('100.10');
    expect(entry.balanceAfter.toString()).toBe('75.05');

    expect(entry.createdAt).toEqual(entity.createdAt);
    expect(entry.isBalanced()).toBe(true);
  });

  it('should convert WalletLedgerEntry domain to persistence', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef38',
      transactionId: '0192f291-27dd-7d3f-8071-5f8685deef39',
      direction: LedgerDirection.Credit,

      money: Money.from({
        amount: '25.05',
        currency: 'BRL',
      }),

      balanceBefore: Money.from({
        amount: '75.05',
        currency: 'BRL',
      }),

      balanceAfter: Money.from({
        amount: '100.10',
        currency: 'BRL',
      }),

      createdAt: new Date('2026-10-04T10:00:00.000Z'),
    });

    const entity = WalletLedgerEntryMapper.toPersistence(entry);

    expect(entity).toBeInstanceOf(WalletLedgerEntryEntity);

    expect(entity).toBeInstanceOf(WalletLedgerEntryEntity);

    expect(entity.id).toBe(entry.id);

    expect(entity.direction).toBe(LedgerDirection.Credit);

    expect(entity.direction).toBe(LedgerDirection.Credit);

    expect(entity.amount).toBe('25.05');
    expect(entity.currency).toBe('BRL');
    expect(entity.balanceBefore).toBe('75.05');
    expect(entity.balanceAfter).toBe('100.10');

    expect(entity.createdAt).toEqual(entry.createdAt);
  });

  it('should preserve all monetary values during persistence round-trip', () => {
    const original = WalletLedgerEntry.rehydrate({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef38',
      transactionId: '0192f291-27dd-7d3f-8071-5f8685deef39',
      direction: LedgerDirection.Debit,

      money: Money.from({
        amount: '25.05',
        currency: 'BRL',
      }),

      balanceBefore: Money.from({
        amount: '100.10',
        currency: 'BRL',
      }),

      balanceAfter: Money.from({
        amount: '75.05',
        currency: 'BRL',
      }),

      createdAt: new Date('2026-10-04T10:00:00.000Z'),
    });

    const entity = WalletLedgerEntryMapper.toPersistence(original);
    const restored = WalletLedgerEntryMapper.toDomain(entity);

    expect(entity.amount).toBe('25.05');
    expect(entity.balanceBefore).toBe('100.10');
    expect(entity.balanceAfter).toBe('75.05');

    expect(restored.money.equals(original.money)).toBe(true);
    expect(restored.balanceBefore.equals(original.balanceBefore)).toBe(true);
    expect(restored.balanceAfter.equals(original.balanceAfter)).toBe(true);

    expect(restored.isBalanced()).toBe(true);
  });
});
