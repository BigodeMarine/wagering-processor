import {
  DeleteMessageCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import mikroOrmConfig from '../../../src/mikro-orm.config.js';

import { ProcessWagerMessage } from '../../../src/application/use-cases/process-wager-message.js';
import { ProcessWagerTransaction } from '../../../src/application/use-cases/process-wager-transaction.js';

import { WalletEntity } from '../../../src/persistence/entities/wallet.entity.js';
import { WagerTransactionEntity } from '../../../src/persistence/entities/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from '../../../src/persistence/entities/wallet-ledger-entry.entity.js';
import { InboxMessageEntity } from '../../../src/persistence/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../../../src/persistence/entities/outbox-message.entity.js';

import { MikroOrmTransactionManager } from '../../../src/persistence/mikro-orm-transaction-manager.js';

import { SystemClock } from '../../../src/infrastructure/time/system-clock.js';
import { UuidGenerator } from '../../../src/infrastructure/ids/uuid-generator.js';

import { WagerTransactionConsumer } from '../../../src/infrastructure/messaging/sqs/wager-transaction.consumer.js';

import {
  ensureWageringQueues,
  getWageringDlqUrl,
  getWageringQueueUrl,
  sqsClient,
} from '../../../src/infrastructure/messaging/sqs/sqs.config.js';

describe('WagerTransactionConsumer DLQ integration', () => {
  let orm: MikroORM;
  let queueUrl: string;
  let dlqUrl: string;
  let consumer: WagerTransactionConsumer;

  beforeAll(async () => {
    /*
     * Reduces the redelivery interval only for this integration test.
     * Production/default behavior remains 30 seconds.
     */
    process.env.SQS_VISIBILITY_TIMEOUT_SECONDS = '1';

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

    queueUrl = await getWageringQueueUrl();
    dlqUrl = await getWageringDlqUrl();

    const transactionManager = new MikroOrmTransactionManager(orm.em.fork());

    const clock = new SystemClock();
    const idGenerator = new UuidGenerator();

    const processWagerTransaction = new ProcessWagerTransaction(
      transactionManager,
      idGenerator,
      clock,
    );

    const processWagerMessage = new ProcessWagerMessage(
      transactionManager,
      processWagerTransaction,
      clock,
    );

    consumer = new WagerTransactionConsumer(processWagerMessage);
  });

  beforeEach(async () => {
    await purge(queueUrl);
    await purge(dlqUrl);
  });

  afterAll(async () => {
    if (consumer) {
      await consumer.onApplicationShutdown();
    }

    delete process.env.SQS_VISIBILITY_TIMEOUT_SECONDS;

    if (orm) {
      await orm.close(true);
    }
  });

  it('moves a repeatedly failing message to the DLQ without acknowledging it', async () => {
    /*
     * Invalid JSON guarantees that processing fails before the
     * financial use case can execute.
     *
     * The consumer must not ACK/DeleteMessage on this path.
     */
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: '{ invalid-json',
        MessageGroupId: crypto.randomUUID(),
        MessageDeduplicationId: crypto.randomUUID(),
      }),
    );

    await consumer.onApplicationBootstrap();

    const dlqMessage = await waitForDlqMessage(dlqUrl, 15_000);

    expect(dlqMessage).toBeDefined();
    expect(dlqMessage?.Body).toBe('{ invalid-json');

    /*
     * Clean up the message so the test remains repeatable.
     */
    if (dlqMessage?.ReceiptHandle) {
      await sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: dlqUrl,
          ReceiptHandle: dlqMessage.ReceiptHandle,
        }),
      );
    }
  }, 20_000);
});

async function purge(queueUrl: string): Promise<void> {
  try {
    await sqsClient.send(
      new PurgeQueueCommand({
        QueueUrl: queueUrl,
      }),
    );
  } catch {
    /*
     * LocalStack may reject consecutive purge operations.
     */
  }
}

async function waitForDlqMessage(dlqUrl: string, timeoutMilliseconds: number) {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      }),
    );

    const message = response.Messages?.[0];

    if (message) {
      return message;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Message was not moved to DLQ within ${timeoutMilliseconds}ms`,
  );
}
