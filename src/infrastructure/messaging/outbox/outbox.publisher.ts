import { Injectable, Logger } from '@nestjs/common';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';

import type { Clock } from '../../../application/ports/clock.js';
import type { IdGenerator } from '../../../application/ports/id-generator.js';
import type { TransactionManager } from '../../../application/ports/transaction-manager.js';
import type { OutboxMessage } from '../../../domain/messaging/outbox-message.js';

@Injectable()
export class OutboxPublisher {
  private static readonly CLAIM_LEASE_MILLISECONDS = 30_000;
  private static readonly BATCH_SIZE = 10;

  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly publisherId: string;

  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
    private readonly clock: Clock,
    idGenerator: IdGenerator,
  ) {
    this.publisherId = idGenerator.generate();
  }

  /**
   * Executa um ciclo de publicação da Outbox.
   *
   * O claim é confirmado no PostgreSQL antes que qualquer
   * chamada externa ao SQS seja realizada.
   */
  async publishPending(): Promise<number> {
    const messages = await this.claimBatch();

    for (const message of messages) {
      await this.publish(message);
    }

    return messages.length;
  }

  /**
   * Reserva um lote dentro de uma transação curta.
   *
   * O repository utiliza FOR UPDATE SKIP LOCKED para permitir
   * múltiplos publishers concorrentes.
   */
  private async claimBatch(): Promise<OutboxMessage[]> {
    return this.transactionManager.transactional(async (context) => {
      return context.outbox.claimPending(
        this.publisherId,
        this.clock.now(),
        OutboxPublisher.CLAIM_LEASE_MILLISECONDS,
        OutboxPublisher.BATCH_SIZE,
      );
    });
  }

  private async publish(message: OutboxMessage): Promise<void> {
    try {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(message.payload),

          /*
          * O publisher do Outbox oferece entrega at-least-once.
          * A deduplicação FIFO é uma salvaguarda adicional de transporte,
          * não o mecanismo de idempotência financeira.
          */
          MessageGroupId: message.aggregateId,
          MessageDeduplicationId: message.id,
        }),
      );

      await this.markPublished(message);
    } catch (error) {
      await this.scheduleRetry(message);

      this.logger.error(
        `Failed to publish Outbox message ${message.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async markPublished(message: OutboxMessage): Promise<void> {
    message.markPublished(this.clock.now());

    await this.transactionManager.transactional(async (context) => {
      await context.outbox.save(message);
    });
  }

  private async scheduleRetry(message: OutboxMessage): Promise<void> {
    message.scheduleRetry(this.clock.now());

    await this.transactionManager.transactional(async (context) => {
      await context.outbox.save(message);
    });
  }
}
