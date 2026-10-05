import type { EntityManager } from '@mikro-orm/postgresql';
import type { OutboxRepository } from '../../application/ports/repositories/outbox.repository.js';
import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import { OutboxMessageEntity } from '../entities/outbox-message.entity.js';
import { OutboxMessageMapper } from '../mappers/outbox-message.mapper.js';

/**
 * Implementação PostgreSQL/MikroORM da Transactional Outbox.
 */
export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Insere uma nova mensagem ou atualiza o estado mutável
   * de uma mensagem já persistida.
   */
  async save(message: OutboxMessage): Promise<void> {
    const existing = await this.em.findOne(OutboxMessageEntity, {
      id: message.id,
    });

    if (existing) {
      OutboxMessageMapper.updatePersistence(existing, message);
      return;
    }

    const entity = OutboxMessageMapper.toPersistence(message);

    this.em.persist(entity);
  }

  /**
   * Reserva mensagens pendentes para uma instância do publisher.
   *
   * FOR UPDATE SKIP LOCKED permite que publishers concorrentes
   * trabalhem em paralelo sem selecionar as mesmas linhas.
   *
   * O claim é persistido antes da publicação externa. Portanto,
   * a transação PostgreSQL pode terminar antes do I/O com SQS.
   */
  async claimPending(
    publisherId: string,
    now: Date,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<OutboxMessage[]> {
    if (limit <= 0) {
      return [];
    }

    const claimUntil = new Date(now.getTime() + leaseMilliseconds);

    const rows = await this.em.getConnection().execute<
      Array<{
        id: string;
        aggregate_id: string;
        event_type: string;
        payload: OutboxMessage['payload'];
        occurred_at: Date;
        attempts: number;
        next_attempt_at: Date | null;
        published_at: Date | null;
        claimed_by: string | null;
        claim_until: Date | null;
      }>
    >(
      `
      WITH candidates AS (
        SELECT id
        FROM outbox_message
        WHERE published_at IS NULL
          AND (
            next_attempt_at IS NULL
            OR next_attempt_at <= ?
          )
          AND (
            claim_until IS NULL
            OR claim_until <= ?
          )
        ORDER BY occurred_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_message AS outbox
      SET
        claimed_by = ?,
        claim_until = ?
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING
        outbox.id,
        outbox.aggregate_id,
        outbox.event_type,
        outbox.payload,
        outbox.occurred_at,
        outbox.attempts,
        outbox.next_attempt_at,
        outbox.published_at,
        outbox.claimed_by,
        outbox.claim_until
    `,
      [now, now, limit, publisherId, claimUntil],
    );

    return rows.map((row) =>
      OutboxMessage.rehydrate({
        id: row.id,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        occurredAt: row.occurred_at,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at ?? undefined,
        publishedAt: row.published_at ?? undefined,
        claimedBy: row.claimed_by ?? undefined,
        claimUntil: row.claim_until ?? undefined,
      }),
    );
  }
}
