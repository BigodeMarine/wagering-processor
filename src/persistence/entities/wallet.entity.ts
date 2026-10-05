import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallet' })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({
    type: 'uuid',
    fieldName: 'player_id',
  })
  playerId!: string;

  @Property({
    type: 'string',
    length: 3,
  })
  currency!: string;

  @Property({
    type: 'decimal',
    precision: 19,
    scale: 2,
  })
  balance!: string;

  @Property({
    type: 'integer',
  })
  version!: number;

  @Property({
    type: 'datetime',
    fieldName: 'created_at',
  })
  createdAt!: Date;

  @Property({
    type: 'datetime',
    fieldName: 'updated_at',
  })
  updatedAt!: Date;
}
