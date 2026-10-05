import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { SerializedIntegrationEvent } from '../../domain/events/integration-event.js';

/**
 * Representação persistida de um evento aguardando publicação.
 * O payload contém o envelope completo e versionado do IntegrationEvent.
 */
@Entity({ tableName: 'outbox_message' })
export class OutboxMessageEntity {
  @PrimaryKey({
    type: 'uuid',
  })
  id!: string;

  @Property({
    type: 'uuid',
    fieldName: 'aggregate_id',
  })
  aggregateId!: string;

  @Property({
    type: 'string',
    fieldName: 'event_type',
  })
  eventType!: string;

  @Property({
    type: 'json',
  })
  payload!: SerializedIntegrationEvent<unknown>;

  @Property({
    type: 'datetime',
    fieldName: 'occurred_at',
  })
  occurredAt!: Date;

  @Property({
    type: 'integer',
  })
  attempts!: number;

  @Property({
    type: 'datetime',
    fieldName: 'next_attempt_at',
    nullable: true,
  })
  nextAttemptAt?: Date;

  @Property({
    type: 'datetime',
    fieldName: 'published_at',
    nullable: true,
  })
  publishedAt?: Date;

  @Property({
    type: 'string',
    fieldName: 'claimed_by',
    nullable: true,
  })
  claimedBy?: string;

  @Property({
    type: 'datetime',
    fieldName: 'claim_until',
    nullable: true,
  })
  claimUntil?: Date;
}
