import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

import { WalletEntity } from './wallet.entity.js';

@Entity({ tableName: 'wager_transaction' })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({
    type: 'string',
    fieldName: 'provider_id',
  })
  providerId!: string;

  @Property({
    type: 'string',
    fieldName: 'external_transaction_id',
  })
  externalTransactionId!: string;

  @Property({
    type: 'string',
    fieldName: 'idempotency_key',
  })
  idempotencyKey!: string;

  @Property({
    type: 'string',
    fieldName: 'payload_hash',
  })
  payloadHash!: string;

  @ManyToOne({
    entity: () => WalletEntity,
    fieldName: 'wallet_id',
  })
  wallet!: WalletEntity;

  @Property({
    type: 'uuid',
    fieldName: 'player_id',
  })
  playerId!: string;

  @Property({
    type: 'string',
    fieldName: 'round_id',
  })
  roundId!: string;

  @Property({
    type: 'string',
    fieldName: 'game_id',
  })
  gameId!: string;

  @Property({
    type: 'string',
  })
  kind!: string;

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
    type: 'string',
    fieldName: 'reference_external_transaction_id',
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @Property({
    type: 'uuid',
    fieldName: 'reference_transaction_id',
    nullable: true,
  })
  referenceTransactionId?: string;

  @Property({
    type: 'string',
  })
  status!: string;

  @Property({
    type: 'string',
    fieldName: 'failure_code',
    nullable: true,
  })
  failureCode?: string;

  @Property({
    type: 'datetime',
    fieldName: 'created_at',
  })
  createdAt!: Date;

  @Property({
    type: 'datetime',
    fieldName: 'processed_at',
    nullable: true,
  })
  processedAt?: Date;

  @Property({
    type: 'string',
    fieldName: 'resulting_balance',
    columnType: 'numeric(19,2)',
    nullable: true,
  })
  resultingBalance?: string;
}
