import {
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import mikroOrmConfig from '../../../src/mikro-orm.config.js';

import { Money } from '../../../src/domain/money/money.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';

import { ProcessWagerMessage } from '../../../src/application/use-cases/process-wager-message.js';
import { ProcessWagerTransaction } from '../../../src/application/use-cases/process-wager-transaction.js';

import { MikroOrmTransactionManager } from '../../../src/persistence/mikro-orm-transaction-manager.js';

import { WalletEntity } from '../../../src/persistence/entities/wallet.entity.js';
import { InboxMessageEntity } from '../../../src/persistence/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../../../src/persistence/entities/outbox-message.entity.js';
import { WagerTransactionEntity } from '../../../src/persistence/entities/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from '../../../src/persistence/entities/wallet-ledger-entry.entity.js';

import { SystemClock } from '../../../src/infrastructure/time/system-clock.js';
import { UuidGenerator } from '../../../src/infrastructure/ids/uuid-generator.js';

import { WagerTransactionConsumer } from '../../../src/infrastructure/messaging/sqs/wager-transaction.consumer.js';

import {
  ensureWageringQueues,
  getWageringQueueUrl,
  sqsClient,
} from '../../../src/infrastructure/messaging/sqs/sqs.config.js';

describe('WagerTransactionConsumer integration', () => {
  let orm: MikroORM;
  let queueUrl: string;
  let consumer: WagerTransactionConsumer;

  beforeAll(async () => {
    /*
     * Explicit entities avoid dynamic entity discovery during
     * the Vitest integration environment.
     */
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
    /*
     * Clear database state while respecting FK dependencies.
     */
    await orm.em.nativeDelete(OutboxMessageEntity, {});
    await orm.em.nativeDelete(InboxMessageEntity, {});
    await orm.em.nativeDelete(WalletLedgerEntryEntity, {});
    await orm.em.nativeDelete(WagerTransactionEntity, {});
    await orm.em.nativeDelete(WalletEntity, {});

    /*
     * Keep the real LocalStack queue isolated between scenarios.
     */
    try {
      await sqsClient.send(
        new PurgeQueueCommand({
          QueueUrl: queueUrl,
        }),
      );
    } catch {
      /*
       * LocalStack may reject consecutive purge requests.
       * This does not affect the database cleanup.
       */
    }
  });

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  it('processes a real SQS wager and acknowledges it only after successful processing', async () => {
    const walletId = crypto.randomUUID();
    const playerId = crypto.randomUUID();

    /*
     * Arrange the initial financial state through the same
     * persistence abstraction used by the application.
     */
    const wallet = Wallet.open({
      id: walletId,
      playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: new Date(),
    });

    const setupTransactionManager = new MikroOrmTransactionManager(
      orm.em.fork(),
    );

    await setupTransactionManager.transactional(async (context) => {
      await context.wallet.save(wallet);
    });

    /*
     * Start the real long-polling SQS consumer.
     */
    await consumer.onApplicationBootstrap();

    const message = {
      idempotencyKey: `idem-${crypto.randomUUID()}`,
      providerId: 'integration-provider',
      externalTransactionId: `external-${crypto.randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-001',
      gameId: 'game-001',
      kind: WagerTransactionKind.Bet,
      money: {
        amount: '80.00',
        currency: 'BRL',
      },
    };

    /*
     * Send a real FIFO message to LocalStack.
     *
     * FIFO ordering is useful, but financial idempotency does not
     * depend on SQS deduplication.
     */
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: walletId,
        MessageDeduplicationId: crypto.randomUUID(),
      }),
    );

    /*
     * Wait until the asynchronous consumer commits the financial
     * operation in PostgreSQL.
     */
    await waitFor(async () => {
      const verificationEm = orm.em.fork();

      const persistedWallet = await verificationEm.findOne(WalletEntity, {
        id: walletId,
      });

      return persistedWallet?.balance === '20.00';
    });

    const verificationEm = orm.em.fork();

    /*
     * Wallet: 100.00 - 80.00 = 20.00.
     */
    const persistedWallet = await verificationEm.findOneOrFail(WalletEntity, {
      id: walletId,
    });

    expect(persistedWallet.balance).toBe('20.00');
    expect(persistedWallet.version).toBe(2);

    /*
     * Exactly one financial transaction must exist.
     */
    const persistedTransactions = await verificationEm.find(
      WagerTransactionEntity,
      {
        wallet: walletId,
      },
    );

    expect(persistedTransactions).toHaveLength(1);
    expect(persistedTransactions[0]?.status).toBe('PROCESSED');
    expect(persistedTransactions[0]?.resultingBalance).toBe('20.00');

    /*
     * Exactly one immutable debit must have been written.
     */
    const ledgerEntries = await verificationEm.find(WalletLedgerEntryEntity, {
      wallet: walletId,
    });

    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]?.direction).toBe('DEBIT');
    expect(ledgerEntries[0]?.amount).toBe('80.00');
    expect(ledgerEntries[0]?.balanceBefore).toBe('100.00');
    expect(ledgerEntries[0]?.balanceAfter).toBe('20.00');

    /*
     * The SQS delivery must have been persisted and completed
     * through the Inbox.
     */
    const inboxMessages = await verificationEm.find(InboxMessageEntity, {});

    expect(inboxMessages).toHaveLength(1);
    expect(inboxMessages[0]?.consumerName).toBe('wager-transaction-consumer');
    expect(inboxMessages[0]?.processedAt).not.toBeNull();

    /*
     * ProcessWagerMessage returns only after the PostgreSQL
     * transaction commits. The consumer issues DeleteMessage
     * afterwards.
     */
    await sleep(500);

    const queueResult = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      }),
    );

    expect(queueResult.Messages ?? []).toHaveLength(0);

    /*
     * Stop this consumer before the test finishes so it cannot
     * compete for messages with other integration test files.
     */
    await consumer.onApplicationShutdown();
  }, 20_000);
});

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMilliseconds = 10_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (await condition()) {
      return;
    }

    await sleep(100);
  }

  throw new Error('Timed out waiting for condition');
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
