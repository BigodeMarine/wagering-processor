import { PurgeQueueCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mikroOrmConfig from '../../../src/mikro-orm.config.js';
import { OutboxMessage } from '../../../src/domain/messaging/outbox-message.js';
import { MikroOrmTransactionManager } from '../../../src/persistence/mikro-orm-transaction-manager.js';
import { WalletEntity } from '../../../src/persistence/entities/wallet.entity.js';
import { WagerTransactionEntity } from '../../../src/persistence/entities/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from '../../../src/persistence/entities/wallet-ledger-entry.entity.js';
import { InboxMessageEntity } from '../../../src/persistence/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../../../src/persistence/entities/outbox-message.entity.js';
import { SystemClock } from '../../../src/infrastructure/time/system-clock.js';
import { UuidGenerator } from '../../../src/infrastructure/ids/uuid-generator.js';

import { OutboxPublisher } from '../../../src/infrastructure/messaging/outbox/outbox.publisher.js';
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from '../../../src/domain/events/integration-event.js';

import {
  ensureWageringQueues,
  getWageringEventsQueueUrl,
  sqsClient,
} from '../../../src/infrastructure/messaging/sqs/sqs.config.js';

interface TestIntegrationEventData {
  test: boolean;
}

/**
 * Evento concreto usado somente para exercitar a infraestrutura
 * da Transactional Outbox neste teste de integração.
 */
class TestIntegrationEvent extends IntegrationEvent<TestIntegrationEventData> {
  readonly eventType = 'OutboxPublisherIntegrationTest';
  readonly version = 1;

  constructor(props: IntegrationEventProps<TestIntegrationEventData>) {
    super(props);
  }
}

describe('OutboxPublisher integration', () => {
  let orm: MikroORM;
  let queueUrl: string;

  beforeAll(async () => {
    orm = await MikroORM.init({
      ...mikroOrmConfig,
      entities: [
        WalletEntity,
        WagerTransactionEntity,
        WalletLedgerEntryEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ],
      entitiesTs: [],
    });

    await ensureWageringQueues();

    queueUrl = await getWageringEventsQueueUrl();
  });

  beforeEach(async () => {
    await orm.em.nativeDelete(OutboxMessageEntity, {});
    await orm.em.nativeDelete(InboxMessageEntity, {});
    await orm.em.nativeDelete(WalletLedgerEntryEntity, {});
    await orm.em.nativeDelete(WagerTransactionEntity, {});
    await orm.em.nativeDelete(WalletEntity, {});

    try {
      await sqsClient.send(
        new PurgeQueueCommand({
          QueueUrl: queueUrl,
        }),
      );
    } catch {
      // LocalStack may reject consecutive purge requests.
    }
  });

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  it('allows only one concurrent publisher to claim and publish the same outbox message', async () => {
    const eventId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();
    const occurredAt = new Date();

    const event = new TestIntegrationEvent({
      eventId,
      aggregateId,
      correlationId: crypto.randomUUID(),
      occurredAt,
      data: {
        test: true,
      },
    });

    const outboxMessage = OutboxMessage.enqueue(event);

    /*
     * Persist one pending Outbox event before starting
     * the competing publishers.
     */
    const setupTransactionManager = new MikroOrmTransactionManager(
      orm.em.fork(),
    );

    await setupTransactionManager.transactional(async (context) => {
      await context.outbox.save(outboxMessage);
    });

    /*
     * Separate EntityManagers simulate independent application
     * instances competing for the same PostgreSQL Outbox.
     */
    const transactionManagerA = new MikroOrmTransactionManager(orm.em.fork());

    const transactionManagerB = new MikroOrmTransactionManager(orm.em.fork());

    const publisherA = new OutboxPublisher(
      transactionManagerA,
      sqsClient,
      queueUrl,
      new SystemClock(),
      new UuidGenerator(),
    );

    const publisherB = new OutboxPublisher(
      transactionManagerB,
      sqsClient,
      queueUrl,
      new SystemClock(),
      new UuidGenerator(),
    );

    /*
     * Both publishers race for the same pending row.
     */
    const results = await Promise.all([
      publisherA.publishPending(),
      publisherB.publishPending(),
    ]);

    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);

    const verificationEm = orm.em.fork();

    const persistedMessage = await verificationEm.findOneOrFail(
      OutboxMessageEntity,
      {
        id: eventId,
      },
    );

    expect(persistedMessage.publishedAt).toBeDefined();
    expect(persistedMessage.claimedBy).toBeNull();
    expect(persistedMessage.claimUntil).toBeNull();

    /*
     * Only one broker message should have been produced
     * during this publication cycle.
     */
    const received = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );

    expect(received.Messages ?? []).toHaveLength(1);
  }, 20_000);
});
