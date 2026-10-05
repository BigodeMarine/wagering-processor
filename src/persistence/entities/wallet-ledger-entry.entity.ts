import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

import { WagerTransactionEntity } from './wager-transaction.entity.js';
import { WalletEntity } from './wallet.entity.js';

@Entity({ tableName: 'wallet_ledger_entry' })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @ManyToOne({
    entity: () => WalletEntity,
    fieldName: 'wallet_id',
  })
  wallet!: WalletEntity;

  @ManyToOne({
    entity: () => WagerTransactionEntity,
    fieldName: 'transaction_id',
  })
  transaction!: WagerTransactionEntity;

  @Property({
    type: 'string',
  })
  direction!: string;

  @Property({
    type: 'decimal',
    precision: 19,
    scale: 2,
  })
  amount!: string;

  @Property({
    type: 'string',
    length: 3,
  })
  currency!: string;

  @Property({
    type: 'decimal',
    precision: 19,
    scale: 2,
    fieldName: 'balance_before',
  })
  balanceBefore!: string;

  @Property({
    type: 'decimal',
    precision: 19,
    scale: 2,
    fieldName: 'balance_after',
  })
  balanceAfter!: string;

  @Property({
    type: 'datetime',
    fieldName: 'created_at',
  })
  createdAt!: Date;
}
