import {
  IntegrationEvent,
  type SerializedIntegrationEvent,
} from '../events/integration-event.js';

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: SerializedIntegrationEvent<unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
  claimedBy?: string;
  claimUntil?: Date;
}

/**
 * Representa um evento de integração persistido na Transactional Outbox.
 *
 * O evento permanece pendente até que sua publicação seja confirmada.
 * Publishers concorrentes utilizam um claim temporário para evitar que
 * processem simultaneamente a mesma mensagem.
 */
export class OutboxMessage {
  private static readonly MAX_RETRY_DELAY_SECONDS = 60;

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: SerializedIntegrationEvent<unknown>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
    private _claimedBy?: string,
    private _claimUntil?: Date,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON(),
      event.occurredAt,
      0,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
      state.claimedBy,
      state.claimUntil,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  get claimedBy(): string | undefined {
    return this._claimedBy;
  }

  get claimUntil(): Date | undefined {
    return this._claimUntil;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }

    if (
      this._claimUntil !== undefined &&
      this._claimUntil.getTime() > now.getTime()
    ) {
      return false;
    }

    if (this._nextAttemptAt === undefined) {
      return true;
    }

    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  /**
   * Registra a posse temporária da mensagem por uma instância do publisher.
   */
  claim(publisherId: string, now: Date, leaseMilliseconds: number): void {
    if (!this.isDue(now)) {
      throw new Error(`Outbox message "${this.id}" is not available for claim`);
    }

    this._claimedBy = publisherId;
    this._claimUntil = new Date(now.getTime() + leaseMilliseconds);
  }

  /**
   * Marca a publicação como concluída e libera o claim.
   */
  markPublished(at: Date): void {
    if (!this.isPending()) {
      return;
    }

    this._publishedAt = at;
    this._nextAttemptAt = undefined;
    this.releaseClaim();
  }

  /**
   * Registra falha de publicação e agenda retry com backoff exponencial.
   */
  scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      return;
    }

    this._attempts += 1;

    const exponentialDelay = 2 ** (this._attempts - 1);

    const delaySeconds = Math.min(
      exponentialDelay,
      OutboxMessage.MAX_RETRY_DELAY_SECONDS,
    );

    this._nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000);

    this.releaseClaim();
  }

  /**
   * Libera a posse temporária da mensagem.
   */
  private releaseClaim(): void {
    this._claimedBy = undefined;
    this._claimUntil = undefined;
  }
}
