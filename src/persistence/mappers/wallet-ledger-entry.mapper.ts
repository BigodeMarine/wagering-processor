import { rel } from '@mikro-orm/core';

import { Money } from '../../domain/money/money.js';
import { LedgerDirection } from '../../domain/ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';
import { WalletEntity } from '../entities/wallet.entity.js';

export class WalletLedgerEntryMapper {
  static toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.wallet.id,
      transactionId: entity.transaction.id,
      direction: entity.direction as LedgerDirection,
      money: Money.from({
        amount: entity.amount,
        currency: entity.currency,
      }),
      balanceBefore: Money.from({
        amount: entity.balanceBefore,
        currency: entity.currency,
      }),
      balanceAfter: Money.from({
        amount: entity.balanceAfter,
        currency: entity.currency,
      }),
      createdAt: entity.createdAt,
    });
  }

  static toPersistence(
    entry: WalletLedgerEntry,
  ): WalletLedgerEntryEntity {
    const entity = new WalletLedgerEntryEntity();

    entity.id = entry.id;
    entity.wallet = rel(WalletEntity, entry.walletId);
    entity.transaction = rel(
      WagerTransactionEntity,
      entry.transactionId,
    );
    entity.direction = entry.direction;
    entity.amount = entry.money.toString();
    entity.currency = entry.money.currency;
    entity.balanceBefore = entry.balanceBefore.toString();
    entity.balanceAfter = entry.balanceAfter.toString();
    entity.createdAt = entry.createdAt;

    return entity;
  }
}