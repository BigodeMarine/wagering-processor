import { MikroORM } from '@mikro-orm/postgresql';

import mikroOrmConfig from '../../../src/mikro-orm.config.js';

import { CreateWallet } from '../../../src/application/use-cases/create-wallet.js';
import type { Clock } from '../../../src/application/ports/clock.js';
import type { IdGenerator } from '../../../src/application/ports/id-generator.js';

import { MikroOrmTransactionManager } from '../../../src/persistence/mikro-orm-transaction-manager.js';

import { WalletEntity } from '../../../src/persistence/entities/wallet.entity.js';
import { WagerTransactionEntity } from '../../../src/persistence/entities/wager-transaction.entity.js';
import { WalletLedgerEntryEntity } from '../../../src/persistence/entities/wallet-ledger-entry.entity.js';
import { InboxMessageEntity } from '../../../src/persistence/entities/inbox-message.entity.js';
import { OutboxMessageEntity } from '../../../src/persistence/entities/outbox-message.entity.js';

describe('CreateWallet - integration', () => {
  let orm: MikroORM | undefined;
  let createWallet: CreateWallet;

  const createdAt = new Date('2026-10-05T20:00:00.000Z');
  const zeroBalancePlayerId = '0192f300-0000-7000-8000-000000000001';

  const openingBalancePlayerId = '0192f300-0000-7000-8000-000000000002';

  const duplicatePlayerId = '0192f300-0000-7000-8000-000000000003';

  const clock: Clock = {
    now: () => createdAt,
  };

  const idGenerator: IdGenerator = {
    generate: () => crypto.randomUUID(),
  };

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

    createWallet = new CreateWallet(
      new MikroOrmTransactionManager(orm.em),
      idGenerator,
      clock,
    );
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
     * Limpa os registros respeitando as dependências entre
     * as tabelas utilizadas pelo processamento financeiro.
     */
    await orm.em.nativeDelete(OutboxMessageEntity, {});
    await orm.em.nativeDelete(InboxMessageEntity, {});
    await orm.em.nativeDelete(WalletLedgerEntryEntity, {});
    await orm.em.nativeDelete(WagerTransactionEntity, {});
    await orm.em.nativeDelete(WalletEntity, {});
  });

  it('creates a wallet with zero balance without OPENING or ledger entry', async () => {
    const result = await createWallet.execute({
      playerId: zeroBalancePlayerId,
      currency: 'BRL',
      initialBalance: '0.00',
    });

    expect(result.balance).toBe('0.00');
    expect(result.version).toBe(1);
    expect(result.createdAt).toEqual(createdAt);

    const verificationEm = orm!.em.fork();

    const persistedWallet = await verificationEm.findOneOrFail(WalletEntity, {
      id: result.id,
    });

    expect(persistedWallet.playerId).toBe(zeroBalancePlayerId);
    expect(persistedWallet.currency).toBe('BRL');
    expect(persistedWallet.balance).toBe('0.00');
    expect(persistedWallet.version).toBe(1);

    const transactions = await verificationEm.find(WagerTransactionEntity, {
      wallet: result.id,
    });

    const ledgerEntries = await verificationEm.find(WalletLedgerEntryEntity, {
      wallet: result.id,
    });

    expect(transactions).toHaveLength(0);
    expect(ledgerEntries).toHaveLength(0);
  });

  it('creates OPENING and CREDIT ledger atomically when initial balance is positive', async () => {
    const result = await createWallet.execute({
      playerId: openingBalancePlayerId,
      currency: 'BRL',
      initialBalance: '100.00',
    });

    expect(result.balance).toBe('100.00');
    expect(result.version).toBe(2);
    expect(result.createdAt).toEqual(createdAt);

    const verificationEm = orm!.em.fork();

    const persistedWallet = await verificationEm.findOneOrFail(WalletEntity, {
      id: result.id,
    });

    expect(persistedWallet.playerId).toBe(openingBalancePlayerId);
    expect(persistedWallet.currency).toBe('BRL');
    expect(persistedWallet.balance).toBe('100.00');
    expect(persistedWallet.version).toBe(2);

    const transactions = await verificationEm.find(WagerTransactionEntity, {
      wallet: result.id,
    });

    expect(transactions).toHaveLength(1);

    const opening = transactions[0];

    expect(opening.kind).toBe('OPENING');
    expect(opening.status).toBe('PROCESSED');
    expect(opening.amount).toBe('100.00');
    expect(opening.currency).toBe('BRL');
    expect(opening.resultingBalance).toBe('100.00');

    const ledgerEntries = await verificationEm.find(WalletLedgerEntryEntity, {
      wallet: result.id,
    });

    expect(ledgerEntries).toHaveLength(1);

    const ledger = ledgerEntries[0];

    expect(ledger.transaction.id).toBe(opening.id);
    expect(ledger.direction).toBe('CREDIT');
    expect(ledger.amount).toBe('100.00');
    expect(ledger.currency).toBe('BRL');
    expect(ledger.balanceBefore).toBe('0.00');
    expect(ledger.balanceAfter).toBe('100.00');
  });

  it('rejects a second wallet for the same player and currency', async () => {
    await createWallet.execute({
      playerId: duplicatePlayerId,
      currency: 'BRL',
      initialBalance: '100.00',
    });

    await expect(
      createWallet.execute({
        playerId: duplicatePlayerId,
        currency: 'BRL',
        initialBalance: '50.00',
      }),
    ).rejects.toThrow();

    const verificationEm = orm!.em.fork();

    const wallets = await verificationEm.find(WalletEntity, {
      playerId: duplicatePlayerId,
      currency: 'BRL',
    });

    expect(wallets).toHaveLength(1);

    /*
     * A segunda criação precisa sofrer rollback completo:
     * nenhuma segunda OPENING ou movimentação pode sobreviver.
     */
    const transactions = await verificationEm.find(WagerTransactionEntity, {
      wallet: wallets[0].id,
    });

    const ledgerEntries = await verificationEm.find(WalletLedgerEntryEntity, {
      wallet: wallets[0].id,
    });

    expect(transactions).toHaveLength(1);
    expect(ledgerEntries).toHaveLength(1);

    expect(wallets[0].balance).toBe('100.00');
    expect(ledgerEntries[0].balanceBefore).toBe('0.00');
    expect(ledgerEntries[0].balanceAfter).toBe('100.00');
  });
});
