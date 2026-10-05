import { describe, expect, it } from 'vitest';

import { LedgerDirection } from '../ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.js';
import { Money } from '../money/money.js';
import { Wallet } from '../wallet/wallet.js';
import { WalletBalanceChanged } from './wallet-balance-changed.js';

describe('WalletBalanceChanged', () => {
  const occurredAt = new Date('2026-07-29T15:00:00.000Z');

  function createWalletAndEntry() {
    const wallet = Wallet.open({
      id: 'wallet-123',
      playerId: 'player-123',
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-07-29T14:00:00.000Z'),
    });

    const movement = wallet.debit(
      Money.from({
        amount: '25.00',
        currency: 'BRL',
      }),
      occurredAt,
    );

    if (movement === null) {
      throw new Error('Expected wallet movement');
    }

    const entry = WalletLedgerEntry.create({
      id: 'ledger-123',
      walletId: wallet.id,
      transactionId: 'transaction-123',
      movement,
      createdAt: occurredAt,
    });

    return { wallet, entry };
  }

  it('creates a version 1 wallet balance changed event', () => {
    const { wallet, entry } = createWalletAndEntry();

    const event = WalletBalanceChanged.from(wallet, entry, {
      eventId: 'event-123',
      correlationId: 'correlation-123',
      occurredAt,
    });

    expect(event.eventType).toBe('WalletBalanceChanged');
    expect(event.version).toBe(1);
    expect(event.aggregateId).toBe('wallet-123');

    expect(event.data.walletId).toBe('wallet-123');
    expect(event.data.transactionId).toBe('transaction-123');
    expect(event.data.direction).toBe(LedgerDirection.Debit);
    expect(event.data.walletVersion).toBe(2);
  });

  it('serializes financial values as MoneyProps', () => {
    const { wallet, entry } = createWalletAndEntry();

    const event = WalletBalanceChanged.from(wallet, entry, {
      eventId: 'event-123',
      correlationId: 'correlation-123',
      occurredAt,
    });

    expect(event.data.money).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });

    expect(event.data.balanceBefore).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(event.data.balanceAfter).toEqual({
      amount: '75.00',
      currency: 'BRL',
    });
  });

  it('serializes the complete integration event envelope', () => {
    const { wallet, entry } = createWalletAndEntry();

    const event = WalletBalanceChanged.from(wallet, entry, {
      eventId: 'event-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt,
    });

    expect(event.toJSON()).toEqual({
      eventId: 'event-123',
      eventType: 'WalletBalanceChanged',
      aggregateId: 'wallet-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt: '2026-07-29T15:00:00.000Z',
      version: 1,
      data: {
        walletId: 'wallet-123',
        transactionId: 'transaction-123',
        direction: LedgerDirection.Debit,
        money: {
          amount: '25.00',
          currency: 'BRL',
        },
        balanceBefore: {
          amount: '100.00',
          currency: 'BRL',
        },
        balanceAfter: {
          amount: '75.00',
          currency: 'BRL',
        },
        walletVersion: 2,
      },
    });
  });

  it('rejects a ledger entry from another wallet', () => {
    const { wallet, entry } = createWalletAndEntry();

    const anotherWallet = Wallet.open({
      id: 'wallet-456',
      playerId: 'player-456',
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: occurredAt,
    });

    expect(() =>
      WalletBalanceChanged.from(anotherWallet, entry, {
        eventId: 'event-123',
        correlationId: 'correlation-123',
        occurredAt,
      }),
    ).toThrow('Wallet and ledger entry must belong to the same wallet');
  });
});
