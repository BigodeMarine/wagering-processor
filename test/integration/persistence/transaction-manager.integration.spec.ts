import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/mikro-orm.config.js';
import { Money } from '../../../src/domain/money/money.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';
import { MikroOrmTransactionManager } from '../../../src/persistence/mikro-orm-transaction-manager.js';
import { WalletEntity } from '../../../src/persistence/entities/wallet.entity.js';
import { InboxMessageEntity } from '../../../src/persistence/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../../../src/persistence/entities/outbox-message.entity.js';
import { WagerTransactionEntity } from '../../../src/persistence/entities/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from '../../../src/persistence/entities/wallet-ledger-entry.entity.js';
import { InboxMessage } from '../../../src/domain/messaging/inbox-message.js';
import { OutboxMessage } from '../../../src/domain/messaging/outbox-message.js';
import { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry.js';
import { WagerTransaction } from '../../../src/domain/wagering/wager-transaction.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionProcessed } from '../../../src/domain/events/wager-transaction-processed.js';
import { ProcessWagerTransaction } from '../../../src/application/use-cases/process-wager-transaction.js';
import { ProcessWagerMessage } from '../../../src/application/use-cases/process-wager-message.js';
import type { IdGenerator } from '../../../src/application/ports/id-generator.js';
import type { Clock } from '../../../src/application/ports/clock.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction-status.js';
import { FailureCode } from '../../../src/domain/wagering/failure-code.js';

describe('MikroOrmTransactionManager - integration', () => {
  let orm: MikroORM | undefined;
  let transactionManager: MikroOrmTransactionManager;

  const walletId = '0192f291-27dd-7d3f-8071-5f8685deef37';
  const playerId = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';

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

    transactionManager = new MikroOrmTransactionManager(orm.em);
  });

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  beforeEach(async () => {
    if (!orm) {
      throw new Error('MikroORM was not initialized');
    }

    /*
     * Limpa os registros do cenário anterior respeitando
     * a ordem das dependências entre as tabelas.
     */
    await orm.em.nativeDelete(OutboxMessageEntity, {});
    await orm.em.nativeDelete(InboxMessageEntity, {});
    await orm.em.nativeDelete(WalletLedgerEntryEntity, {});
    await orm.em.nativeDelete(WagerTransactionEntity, {});
    await orm.em.nativeDelete(WalletEntity, {});
  });

  it('commits a wallet created inside the transaction', async () => {
    const createdAt = new Date('2026-10-04T12:00:00.000Z');

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt,
    });

    await transactionManager.transactional(async (context) => {
      await context.wallet.save(wallet);
    });

    const persistedWallet = await transactionManager.transactional(
      async (context) => context.wallet.findById(walletId),
    );

    expect(persistedWallet).not.toBeNull();
    expect(persistedWallet?.balance.toString()).toBe('100.00');
    expect(persistedWallet?.version).toBe(1);
  });

  it('rolls back wallet changes when the transaction fails', async () => {
    const createdAt = new Date('2026-10-04T12:00:00.000Z');

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt,
    });

    await transactionManager.transactional(async (context) => {
      await context.wallet.save(wallet);
    });

    await expect(
      transactionManager.transactional(async (context) => {
        const persistedWallet =
          await context.wallet.findByIdForUpdate(walletId);

        if (!persistedWallet) {
          throw new Error('Wallet not found');
        }

        persistedWallet.debit(
          Money.from({
            amount: '25.00',
            currency: 'BRL',
          }),
          new Date('2026-10-04T12:01:00.000Z'),
        );

        await context.wallet.save(persistedWallet);

        /*
         * Simula uma falha ocorrida depois da alteração financeira,
         * mas antes do commit da transação.
         */
        throw new Error('Simulated transaction failure');
      }),
    ).rejects.toThrow('Simulated transaction failure');

    const persistedWallet = await transactionManager.transactional(
      async (context) => context.wallet.findById(walletId),
    );

    expect(persistedWallet).not.toBeNull();

    /*
     * Se o rollback funcionou, nenhuma parte do débito de 25.00
     * pode ter sobrevivido.
     */
    expect(persistedWallet?.balance.toString()).toBe('100.00');
    expect(persistedWallet?.version).toBe(1);
  });

  it('commits wallet, transaction, ledger, inbox and outbox atomically', async () => {
    const createdAt = new Date('2026-10-04T12:00:00.000Z');
    const processedAt = new Date('2026-10-04T12:01:00.000Z');

    const transactionId = '0192f292-27dd-7d3f-8071-5f8685deef38';
    const ledgerEntryId = '0192f293-27dd-7d3f-8071-5f8685deef39';
    const messageId = 'message-bet-001';
    const eventId = '0192f294-27dd-7d3f-8071-5f8685deef40';

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt,
    });

    await transactionManager.transactional(async (context) => {
      const verificationEm = orm!.em.fork();
      /*
       * Representa a mensagem recebida pelo consumer.
       */
      const inboxMessage = InboxMessage.receive({
        messageId,
        consumerName: 'wager-transactions-consumer',
        payloadHash: 'payload-hash-bet-001',
        receivedAt: createdAt,
      });

      const transaction = WagerTransaction.create({
        id: transactionId,
        providerId: 'provider-a',
        externalTransactionId: 'bet-001',
        idempotencyKey: 'provider-a:bet-001',
        payloadHash: 'payload-hash-bet-001',
        walletId,
        playerId,
        roundId: 'round-001',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({
          amount: '25.00',
          currency: 'BRL',
        }),
        createdAt,
      });

      /*
       * A wallet produz a movimentação financeira usada
       * para construir o lançamento imutável do ledger.
       */
      const movement = wallet.debit(transaction.money, processedAt);

      if (!movement) {
        throw new Error('BET must produce a wallet movement');
      }

      const ledgerEntry = WalletLedgerEntry.create({
        id: ledgerEntryId,
        walletId,
        transactionId,
        movement,
        createdAt: processedAt,
      });

      transaction.markProcessed(undefined, wallet.balance, processedAt);

      const event = new WagerTransactionProcessed({
        eventId,
        aggregateId: transaction.id,
        correlationId: messageId,
        occurredAt: processedAt,
        data: {
          transactionId: transaction.id,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          walletId: transaction.walletId,
          playerId: transaction.playerId,
          roundId: transaction.roundId,
          gameId: transaction.gameId,
          kind: transaction.kind,
          money: transaction.money.toJSON(),
        },
      });

      const outboxMessage = OutboxMessage.enqueue(event);

      inboxMessage.markProcessed(processedAt);

      /*
       * Todos os writes usam repositories vinculados ao mesmo
       * EntityManager transacional.
       */
      await context.wallet.save(wallet);
      await context.wagerTransaction.save(transaction);
      await context.ledger.append(ledgerEntry);
      await context.inbox.save(inboxMessage);
      await context.outbox.save(outboxMessage);
    });

    const verificationEm = orm!.em.fork();

    const persistedWallet = await verificationEm.findOneOrFail(WalletEntity, {
      id: walletId,
    });

    const persistedTransaction = await verificationEm.findOneOrFail(
      WagerTransactionEntity,
      {
        id: transactionId,
      },
    );

    const persistedLedger = await verificationEm.findOneOrFail(
      WalletLedgerEntryEntity,
      {
        id: ledgerEntryId,
      },
    );

    const persistedInbox = await verificationEm.findOneOrFail(
      InboxMessageEntity,
      {
        consumerName: 'wager-transactions-consumer',
        messageId,
      },
    );

    const persistedOutbox = await verificationEm.findOneOrFail(
      OutboxMessageEntity,
      {
        id: eventId,
      },
    );

    expect(persistedWallet.balance).toBe('75.00');
    expect(persistedWallet.version).toBe(2);

    expect(persistedTransaction.status).toBe('PROCESSED');
    expect(persistedTransaction.amount).toBe('25.00');
    expect(persistedTransaction.resultingBalance).toBe('75.00');

    expect(persistedLedger.direction).toBe('DEBIT');
    expect(persistedLedger.amount).toBe('25.00');
    expect(persistedLedger.balanceBefore).toBe('100.00');
    expect(persistedLedger.balanceAfter).toBe('75.00');

    expect(persistedInbox.processedAt).toEqual(processedAt);

    expect(persistedOutbox.eventType).toBe('WagerTransactionProcessed');
    expect(persistedOutbox.publishedAt).toBeNull();
    expect(persistedOutbox.attempts).toBe(0);
  });
  it('serializes concurrent BETs on the same wallet and prevents a negative balance', async () => {
    const createdAt = new Date('2026-10-05T15:00:00.000Z');

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt,
    });

    /*
     * Cria o estado inicial antes das duas transações concorrentes.
     */
    await transactionManager.transactional(async (context) => {
      await context.wallet.save(wallet);
    });

    /*
     * Cada execução precisa de IDs diferentes para transaction,
     * ledger e eventos de outbox.
     *
     * crypto.randomUUID() continua produzindo string no domínio.
     */
    const idGenerator: IdGenerator = {
      generate: () => crypto.randomUUID(),
    };

    const clock: Clock = {
      now: () => new Date(),
    };

    /*
     * Usamos dois TransactionManagers com EntityManagers independentes.
     *
     * Isso é importante: queremos duas transações PostgreSQL reais,
     * e não duas operações compartilhando o mesmo contexto.
     */
    const firstTransactionManager = new MikroOrmTransactionManager(
      orm!.em.fork(),
    );

    const secondTransactionManager = new MikroOrmTransactionManager(
      orm!.em.fork(),
    );

    const firstUseCase = new ProcessWagerTransaction(
      firstTransactionManager,
      idGenerator,
      clock,
    );

    const secondUseCase = new ProcessWagerTransaction(
      secondTransactionManager,
      idGenerator,
      clock,
    );

    const firstBet = {
      idempotencyKey: 'provider-a:concurrent-bet-001',
      providerId: 'provider-a',
      externalTransactionId: 'concurrent-bet-001',
      playerId,
      walletId,
      roundId: 'round-concurrent-001',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: {
        amount: '80.00',
        currency: 'BRL',
      },
    };

    const secondBet = {
      idempotencyKey: 'provider-a:concurrent-bet-002',
      providerId: 'provider-a',
      externalTransactionId: 'concurrent-bet-002',
      playerId,
      walletId,
      roundId: 'round-concurrent-001',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: {
        amount: '80.00',
        currency: 'BRL',
      },
    };

    /*
     * As duas operações são iniciadas sem await individual.
     * Portanto competem pelo mesmo row-level lock da Wallet.
     */
    const [firstResult, secondResult] = await Promise.all([
      firstUseCase.execute(firstBet),
      secondUseCase.execute(secondBet),
    ]);

    expect(firstResult).not.toBeNull();
    expect(secondResult).not.toBeNull();

    const results = [firstResult!, secondResult!];

    const processed = results.filter(
      (result) => result.status === WagerTransactionStatus.Processed,
    );

    const rejected = results.filter(
      (result) => result.status === WagerTransactionStatus.Rejected,
    );

    /*
     * Somente uma BET pode consumir os 80.00 disponíveis.
     */
    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(processed[0].balance).toEqual({
      amount: '20.00',
      currency: 'BRL',
    });

    expect(rejected[0].balance).toEqual({
      amount: '20.00',
      currency: 'BRL',
    });

    /*
     * Agora verificamos o estado realmente persistido no PostgreSQL.
     */
    const verificationEm = orm!.em.fork();

    const persistedWallet = await verificationEm.findOneOrFail(WalletEntity, {
      id: walletId,
    });

    expect(persistedWallet.balance).toBe('20.00');
    expect(persistedWallet.version).toBe(2);

    const persistedTransactions = await verificationEm.find(
      WagerTransactionEntity,
      {
        wallet: walletId,
      },
    );

    expect(persistedTransactions).toHaveLength(2);

    const processedTransaction = persistedTransactions.find(
      (transaction) => transaction.status === WagerTransactionStatus.Processed,
    );

    const rejectedTransaction = persistedTransactions.find(
      (transaction) => transaction.status === WagerTransactionStatus.Rejected,
    );

    expect(processedTransaction).toBeDefined();
    expect(rejectedTransaction).toBeDefined();

    expect(processedTransaction?.resultingBalance).toBe('20.00');

    expect(rejectedTransaction?.failureCode).toBe(
      FailureCode.InsufficientBalance,
    );

    expect(rejectedTransaction?.resultingBalance).toBe('20.00');

    /*
     * Apenas a BET processada pode gerar lançamento financeiro.
     */
    const ledgerEntries = await verificationEm.find(WalletLedgerEntryEntity, {
      wallet: walletId,
    });

    expect(ledgerEntries).toHaveLength(1);

    expect(ledgerEntries[0].direction).toBe('DEBIT');
    expect(ledgerEntries[0].amount).toBe('80.00');
    expect(ledgerEntries[0].balanceBefore).toBe('100.00');
    expect(ledgerEntries[0].balanceAfter).toBe('20.00');
  });
  it('processes the same BET exactly once under 50 concurrent requests', async () => {
    const createdAt = new Date('2026-10-05T16:00:00.000Z');

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt,
    });

    await transactionManager.transactional(async (context) => {
      await context.wallet.save(wallet);
    });

    const idGenerator: IdGenerator = {
      generate: () => crypto.randomUUID(),
    };

    const clock: Clock = {
      now: () => new Date(),
    };

    const input = {
      idempotencyKey: 'provider-a:same-bet-concurrent',
      providerId: 'provider-a',
      externalTransactionId: 'same-bet-concurrent',
      playerId,
      walletId,
      roundId: 'round-idempotency-001',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: {
        amount: '80.00',
        currency: 'BRL',
      },
    };

    /*
     * Cada chamada recebe seu próprio EntityManager.
     * Isso simula requisições concorrentes independentes chegando
     * a diferentes contextos da aplicação.
     */
    const requests = Array.from({ length: 50 }, () => {
      const concurrentTransactionManager = new MikroOrmTransactionManager(
        orm!.em.fork(),
      );

      const useCase = new ProcessWagerTransaction(
        concurrentTransactionManager,
        idGenerator,
        clock,
      );

      return useCase.execute(input);
    });

    const results = await Promise.all(requests);

    expect(results).toHaveLength(50);

    /*
     * Todas as chamadas devem observar a mesma transação financeira.
     */
    const transactionIds = new Set(
      results.map((result) => result?.transactionId),
    );

    expect(transactionIds.size).toBe(1);

    /*
     * Exatamente uma chamada executa a operação original.
     * As outras 49 observam o resultado persistido.
     */
    const originals = results.filter(
      (result) => result?.idempotentReplay === false,
    );

    const replays = results.filter(
      (result) => result?.idempotentReplay === true,
    );

    expect(originals).toHaveLength(1);
    expect(replays).toHaveLength(49);

    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result?.status).toBe(WagerTransactionStatus.Processed);

      expect(result?.balance).toEqual({
        amount: '20.00',
        currency: 'BRL',
      });
    }

    /*
     * Verificação final diretamente no PostgreSQL.
     */
    const verificationEm = orm!.em.fork();

    const persistedWallet = await verificationEm.findOneOrFail(WalletEntity, {
      id: walletId,
    });

    expect(persistedWallet.balance).toBe('20.00');
    expect(persistedWallet.version).toBe(2);

    const persistedTransactions = await verificationEm.find(
      WagerTransactionEntity,
      {
        wallet: walletId,
      },
    );

    expect(persistedTransactions).toHaveLength(1);

    expect(persistedTransactions[0].status).toBe(
      WagerTransactionStatus.Processed,
    );

    expect(persistedTransactions[0].resultingBalance).toBe('20.00');

    /*
     * Idempotência financeira:
     * 50 requisições não podem produzir 50 débitos.
     */
    const ledgerEntries = await verificationEm.find(WalletLedgerEntryEntity, {
      wallet: walletId,
    });

    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].direction).toBe('DEBIT');
    expect(ledgerEntries[0].amount).toBe('80.00');
    expect(ledgerEntries[0].balanceBefore).toBe('100.00');
    expect(ledgerEntries[0].balanceAfter).toBe('20.00');
  });
  it('does not apply the financial effect again when an SQS message is redelivered', async () => {
    const createdAt = new Date('2026-10-05T17:00:00.000Z');

    const wallet = Wallet.open({
      id: walletId,
      playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt,
    });

    await transactionManager.transactional(async (context) => {
      await context.wallet.save(wallet);
    });

    const idGenerator: IdGenerator = {
      generate: () => crypto.randomUUID(),
    };

    const clock: Clock = {
      now: () => new Date(),
    };

    const messageTransactionManager = new MikroOrmTransactionManager(
      orm!.em.fork(),
    );

    const processWagerTransaction = new ProcessWagerTransaction(
      messageTransactionManager,
      idGenerator,
      clock,
    );

    const processWagerMessage = new ProcessWagerMessage(
      messageTransactionManager,
      processWagerTransaction,
      clock,
    );

    const message = {
      messageId: 'sqs-message-redelivery-001',
      wager: {
        idempotencyKey: 'provider-a:sqs-redelivery-bet-001',
        providerId: 'provider-a',
        externalTransactionId: 'sqs-redelivery-bet-001',
        playerId,
        walletId,
        roundId: 'round-sqs-redelivery-001',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: {
          amount: '80.00',
          currency: 'BRL',
        },
      },
    };

    /*
     * Primeira entrega da mensagem.
     * O efeito financeiro deve acontecer normalmente.
     */
    const firstResult = await processWagerMessage.execute(message);

    expect(firstResult.alreadyProcessed).toBe(false);
    expect(firstResult.wagerResult).not.toBeNull();

    expect(firstResult.wagerResult?.status).toBe(
      WagerTransactionStatus.Processed,
    );

    expect(firstResult.wagerResult?.balance).toEqual({
      amount: '20.00',
      currency: 'BRL',
    });

    /*
     * Simula redelivery da mesma mensagem pelo SQS.
     *
     * Isso representa, por exemplo, um worker que concluiu o commit
     * no PostgreSQL mas morreu antes de executar DeleteMessage.
     */
    const secondResult = await processWagerMessage.execute(message);

    expect(secondResult.alreadyProcessed).toBe(true);
    expect(secondResult.wagerResult).toBeNull();

    /*
     * Verifica diretamente no PostgreSQL que o segundo processamento
     * não produziu nenhum novo efeito financeiro.
     */
    const verificationEm = orm!.em.fork();

    const persistedWallet = await verificationEm.findOneOrFail(WalletEntity, {
      id: walletId,
    });

    expect(persistedWallet.balance).toBe('20.00');
    expect(persistedWallet.version).toBe(2);

    const persistedTransactions = await verificationEm.find(
      WagerTransactionEntity,
      {
        wallet: walletId,
      },
    );

    expect(persistedTransactions).toHaveLength(1);
    expect(persistedTransactions[0].status).toBe(
      WagerTransactionStatus.Processed,
    );
    expect(persistedTransactions[0].resultingBalance).toBe('20.00');

    const ledgerEntries = await verificationEm.find(WalletLedgerEntryEntity, {
      wallet: walletId,
    });

    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].direction).toBe('DEBIT');
    expect(ledgerEntries[0].amount).toBe('80.00');
    expect(ledgerEntries[0].balanceBefore).toBe('100.00');
    expect(ledgerEntries[0].balanceAfter).toBe('20.00');

    /*
     * A Inbox também deve mostrar que a mensagem foi concluída.
     */
    const inboxMessages = await verificationEm.find(InboxMessageEntity, {
      messageId: message.messageId,
    });

    expect(inboxMessages).toHaveLength(1);
    expect(inboxMessages[0].consumerName).toBe('wager-transaction-consumer');
    expect(inboxMessages[0].processedAt).not.toBeNull();
  });
});
