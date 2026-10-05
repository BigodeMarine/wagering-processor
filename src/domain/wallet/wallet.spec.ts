import { describe, expect, it } from 'vitest';

import { Money } from '../money/money.js';
import { Wallet } from './wallet.js';

describe('Wallet', () => {
  const createdAt = new Date('2026-01-01T10:00:00.000Z');
  const occurredAt = new Date('2026-01-01T11:00:00.000Z');

  function createWallet(): Wallet {
    return Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt,
    });
  }

  describe('open', () => {
    it('should open a wallet with version 1', () => {
      const wallet = createWallet();

      expect(wallet.id).toBe('wallet-1');
      expect(wallet.playerId).toBe('player-1');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(wallet.createdAt).toEqual(createdAt);
      expect(wallet.updatedAt).toEqual(createdAt);
    });

    it('should reject an initial balance with a different currency', () => {
      expect(() =>
        Wallet.open({
          id: 'wallet-1',
          playerId: 'player-1',
          currency: 'BRL',
          initialBalance: Money.from({
            amount: '100.00',
            currency: 'USD',
          }),
          createdAt,
        }),
      ).toThrow('Currency mismatch');
    });
  });

  describe('debit', () => {
    it('should debit the wallet and return the movement', () => {
      const wallet = createWallet();

      const movement = wallet.debit(
        Money.from({
          amount: '80.00',
          currency: 'BRL',
        }),
        occurredAt,
      );

      expect(movement).not.toBeNull();

      expect(movement?.direction).toBe('DEBIT');
      expect(movement?.amount.toString()).toBe('80.00');
      expect(movement?.balanceBefore.toString()).toBe('100.00');
      expect(movement?.balanceAfter.toString()).toBe('20.00');

      expect(wallet.balance.toString()).toBe('20.00');
      expect(wallet.version).toBe(2);
      expect(wallet.updatedAt).toEqual(occurredAt);
    });

    it('should reject a debit that would make the balance negative', () => {
      const wallet = createWallet();

      expect(() =>
        wallet.debit(
          Money.from({
            amount: '100.01',
            currency: 'BRL',
          }),
          occurredAt,
        ),
      ).toThrow('Insufficient balance');

      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(createdAt);
    });

    it('should allow debit of the entire balance', () => {
      const wallet = createWallet();

      const movement = wallet.debit(
        Money.from({
          amount: '100.00',
          currency: 'BRL',
        }),
        occurredAt,
      );

      expect(movement?.balanceAfter.toString()).toBe('0.00');
      expect(wallet.balance.toString()).toBe('0.00');
      expect(wallet.version).toBe(2);
    });

    it('should reject debit in a different currency', () => {
      const wallet = createWallet();

      expect(() =>
        wallet.debit(
          Money.from({
            amount: '10.00',
            currency: 'USD',
          }),
          occurredAt,
        ),
      ).toThrow('Currency mismatch');

      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
    });

    it('should not change balance or version for a zero debit', () => {
      const wallet = createWallet();

      const movement = wallet.debit(Money.zero('BRL'), occurredAt);

      expect(movement).toBeNull();
      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(createdAt);
    });
  });

  describe('credit', () => {
    it('should credit the wallet and return the movement', () => {
      const wallet = createWallet();

      const movement = wallet.credit(
        Money.from({
          amount: '25.00',
          currency: 'BRL',
        }),
        occurredAt,
      );

      expect(movement).not.toBeNull();

      expect(movement?.direction).toBe('CREDIT');
      expect(movement?.amount.toString()).toBe('25.00');
      expect(movement?.balanceBefore.toString()).toBe('100.00');
      expect(movement?.balanceAfter.toString()).toBe('125.00');

      expect(wallet.balance.toString()).toBe('125.00');
      expect(wallet.version).toBe(2);
      expect(wallet.updatedAt).toEqual(occurredAt);
    });

    it('should reject credit in a different currency', () => {
      const wallet = createWallet();

      expect(() =>
        wallet.credit(
          Money.from({
            amount: '25.00',
            currency: 'USD',
          }),
          occurredAt,
        ),
      ).toThrow('Currency mismatch');

      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
    });

    it('should not change balance or version for a zero credit', () => {
      const wallet = createWallet();

      const movement = wallet.credit(Money.zero('BRL'), occurredAt);

      expect(movement).toBeNull();
      expect(wallet.balance.toString()).toBe('100.00');
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(createdAt);
    });
  });

  describe('rehydrate', () => {
    it('should restore the persisted wallet state without applying a transition', () => {
      const persistedCreatedAt = new Date('2026-01-01T10:00:00.000Z');
      const persistedUpdatedAt = new Date('2026-01-03T15:00:00.000Z');

      const wallet = Wallet.rehydrate({
        id: 'wallet-10',
        playerId: 'player-20',
        currency: 'BRL',
        balance: Money.from({
          amount: '350.00',
          currency: 'BRL',
        }),
        version: 7,
        createdAt: persistedCreatedAt,
        updatedAt: persistedUpdatedAt,
      });

      expect(wallet.id).toBe('wallet-10');
      expect(wallet.playerId).toBe('player-20');
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.toString()).toBe('350.00');
      expect(wallet.version).toBe(7);
      expect(wallet.createdAt).toEqual(persistedCreatedAt);
      expect(wallet.updatedAt).toEqual(persistedUpdatedAt);
    });
  });
});