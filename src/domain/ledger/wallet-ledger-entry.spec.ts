import { describe, expect, it } from 'vitest';
import { Money } from '../money/money.js';
import type { WalletMovement } from '../wallet/wallet-movement.js';
import { LedgerDirection } from './ledger-direction.js';
import { WalletLedgerEntry } from './wallet-ledger-entry.js';

describe('WalletLedgerEntry', () => {
  const createdAt = new Date('2026-01-01T10:00:00.000Z');

  describe('create', () => {
    it('should create a balanced debit ledger entry', () => {
      const movement: WalletMovement = {
        direction: 'DEBIT',
        amount: Money.from({
          amount: '80.00',
          currency: 'BRL',
        }),
        balanceBefore: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        balanceAfter: Money.from({
          amount: '20.00',
          currency: 'BRL',
        }),
      };

      const entry = WalletLedgerEntry.create({
        id: 'ledger-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        movement,
        createdAt,
      });

      expect(entry.id).toBe('ledger-1');
      expect(entry.walletId).toBe('wallet-1');
      expect(entry.transactionId).toBe('transaction-1');
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.money.toString()).toBe('80.00');
      expect(entry.balanceBefore.toString()).toBe('100.00');
      expect(entry.balanceAfter.toString()).toBe('20.00');
      expect(entry.createdAt).toEqual(createdAt);
      expect(entry.isBalanced()).toBe(true);
    });

    it('should create a balanced credit ledger entry', () => {
      const movement: WalletMovement = {
        direction: 'CREDIT',
        amount: Money.from({
          amount: '25.00',
          currency: 'BRL',
        }),
        balanceBefore: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        balanceAfter: Money.from({
          amount: '125.00',
          currency: 'BRL',
        }),
      };

      const entry = WalletLedgerEntry.create({
        id: 'ledger-2',
        walletId: 'wallet-1',
        transactionId: 'transaction-2',
        movement,
        createdAt,
      });

      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(entry.money.toString()).toBe('25.00');
      expect(entry.balanceBefore.toString()).toBe('100.00');
      expect(entry.balanceAfter.toString()).toBe('125.00');
      expect(entry.isBalanced()).toBe(true);
    });

    it('should reject an unbalanced debit ledger entry', () => {
      const movement: WalletMovement = {
        direction: 'DEBIT',
        amount: Money.from({
          amount: '80.00',
          currency: 'BRL',
        }),
        balanceBefore: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        balanceAfter: Money.from({
          amount: '50.00',
          currency: 'BRL',
        }),
      };

      expect(() =>
        WalletLedgerEntry.create({
          id: 'ledger-3',
          walletId: 'wallet-1',
          transactionId: 'transaction-3',
          movement,
          createdAt,
        }),
      ).toThrow('Invalid ledger arithmetic');
    });

    it('should reject an unbalanced credit ledger entry', () => {
      const movement: WalletMovement = {
        direction: 'CREDIT',
        amount: Money.from({
          amount: '25.00',
          currency: 'BRL',
        }),
        balanceBefore: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        balanceAfter: Money.from({
          amount: '120.00',
          currency: 'BRL',
        }),
      };

      expect(() =>
        WalletLedgerEntry.create({
          id: 'ledger-4',
          walletId: 'wallet-1',
          transactionId: 'transaction-4',
          movement,
          createdAt,
        }),
      ).toThrow('Invalid ledger arithmetic');
    });
  });

  describe('rehydrate', () => {
    it('should restore a persisted ledger entry without applying creation rules', () => {
      const entry = WalletLedgerEntry.rehydrate({
        id: 'ledger-10',
        walletId: 'wallet-5',
        transactionId: 'transaction-10',
        direction: LedgerDirection.Debit,
        money: Money.from({
          amount: '30.00',
          currency: 'BRL',
        }),
        balanceBefore: Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        balanceAfter: Money.from({
          amount: '70.00',
          currency: 'BRL',
        }),
        createdAt,
      });

      expect(entry.id).toBe('ledger-10');
      expect(entry.walletId).toBe('wallet-5');
      expect(entry.transactionId).toBe('transaction-10');
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.money.toString()).toBe('30.00');
      expect(entry.balanceBefore.toString()).toBe('100.00');
      expect(entry.balanceAfter.toString()).toBe('70.00');
      expect(entry.createdAt).toEqual(createdAt);
      expect(entry.isBalanced()).toBe(true);
    });
  });
});
