import { describe, expect, it, vi } from 'vitest';
import { WagerTransactionStatus } from '../../domain/wagering/wager-transaction-status.js';
import { Money } from '../../domain/money/money.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import { IdempotencyConflictError } from '../errors/idempotency-conflict.error.js';
import { CanonicalPayloadHasher } from '../idempotency/canonical-payload-hasher.js';
import type { TransactionContext } from '../ports/transaction-context.js';
import type { TransactionManager } from '../ports/transaction-manager.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { WalletNotFoundError } from '../errors/wallet-not-found.error.js';
import { CurrencyMismatchError } from '../errors/currency-mismatch.error.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';

import {
  ProcessWagerTransaction,
  type ProcessWagerTransactionInput,
} from './process-wager-transaction.js';

describe('ProcessWagerTransaction', () => {
  const input: ProcessWagerTransactionInput = {
    idempotencyKey: 'provider-a:bet-001',
    providerId: 'provider-a',
    externalTransactionId: 'bet-001',
    playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
    walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
    roundId: 'round-001',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: {
      amount: '25.00',
      currency: 'BRL',
    },
  };
  const transactionId = '0192f292-27dd-7d3f-8071-5f8685deef39';

  const now = new Date('2026-10-05T12:00:00.000Z');

  const idGenerator: IdGenerator = {
    generate: vi.fn().mockReturnValue(transactionId),
  };

  const clock: Clock = {
    now: vi.fn().mockReturnValue(now),
  };

  function createTransactionManager(
    findByIdempotencyKey: TransactionContext['wagerTransaction']['findByIdempotencyKey'],
    findByIdForUpdate: TransactionContext['wallet']['findByIdForUpdate'] = vi
      .fn()
      .mockResolvedValue(null),
    wagerTransactionSave: TransactionContext['wagerTransaction']['save'] = vi
      .fn()
      .mockResolvedValue(undefined),
    walletSave: TransactionContext['wallet']['save'] = vi
      .fn()
      .mockResolvedValue(undefined),
    ledgerAppend: TransactionContext['ledger']['append'] = vi
      .fn()
      .mockResolvedValue(undefined),
    outboxSave: TransactionContext['outbox']['save'] = vi
      .fn()
      .mockResolvedValue(undefined),
    findByProviderAndExternalId: TransactionContext['wagerTransaction']['findByProviderAndExternalId'] = vi
      .fn()
      .mockResolvedValue(null),
    existsReversal: TransactionContext['wagerTransaction']['existsReversal'] = vi
      .fn()
      .mockResolvedValue(false),
  ): TransactionManager {
    const context = {
      wallet: {
        findByIdForUpdate,
        save: walletSave,
      },

      wagerTransaction: {
        findByIdempotencyKey,
        findByProviderAndExternalId,
        existsReversal,
        save: wagerTransactionSave,
      },

      ledger: {
        append: ledgerAppend,
      },

      outbox: {
        save: outboxSave,
      },
    } as TransactionContext;

    return {
      transactional: async <T>(
        work: (context: TransactionContext) => Promise<T>,
      ): Promise<T> => work(context),
    };
  }

  it('continues as a new operation after locking the wallet and rechecking idempotency', async () => {
    const wallet = Wallet.open({
      id: input.walletId,
      playerId: input.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(findByIdempotencyKey, findByIdForUpdate),
      idGenerator,
      clock,
    );

    const result = await useCase.execute(input);

    expect(result).toEqual({
      transactionId,
      status: WagerTransactionStatus.Processed,
      walletId: input.walletId,
      balance: {
        amount: '75.00',
        currency: 'BRL',
      },
      idempotentReplay: false,
    });

    expect(findByIdForUpdate).toHaveBeenCalledOnce();
    expect(findByIdForUpdate).toHaveBeenCalledWith(input.walletId);

    expect(findByIdempotencyKey).toHaveBeenCalledTimes(2);
    expect(findByIdempotencyKey).toHaveBeenNthCalledWith(
      1,
      input.idempotencyKey,
    );
    expect(findByIdempotencyKey).toHaveBeenNthCalledWith(
      2,
      input.idempotencyKey,
    );
  });

  it('returns the original result when key and payload hash match', async () => {
    const payloadHash = CanonicalPayloadHasher.hash(input);

    const existingTransaction = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deef38',
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: Money.from(input.money),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    existingTransaction.markProcessed(
      undefined,
      Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      new Date('2026-10-05T12:01:00.000Z'),
    );

    const findByIdempotencyKey = vi.fn().mockResolvedValue(existingTransaction);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(findByIdempotencyKey),
      idGenerator,
      clock,
    );
    const result = await useCase.execute(input);

    expect(result).toEqual({
      transactionId: existingTransaction.id,
      status: WagerTransactionStatus.Processed,
      walletId: input.walletId,
      balance: {
        amount: '75.00',
        currency: 'BRL',
      },
      idempotentReplay: true,
    });

    expect(findByIdempotencyKey).toHaveBeenCalledOnce();
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const originalPayloadHash = CanonicalPayloadHasher.hash({
      ...input,
      money: {
        amount: '50.00',
        currency: 'BRL',
      },
    });

    const existingTransaction = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deef38',
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: originalPayloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: Money.from({
        amount: '50.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    const findByIdempotencyKey = vi.fn().mockResolvedValue(existingTransaction);
    const useCase = new ProcessWagerTransaction(
      createTransactionManager(findByIdempotencyKey),
      idGenerator,
      clock,
    );
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );

    expect(findByIdempotencyKey).toHaveBeenCalledOnce();
  });

  it('returns the original rejected result on idempotent replay', async () => {
    const payloadHash = CanonicalPayloadHasher.hash(input);

    const existingTransaction = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deef38',
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: Money.from(input.money),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    existingTransaction.reject(
      FailureCode.InsufficientBalance,
      Money.from({
        amount: '20.00',
        currency: 'BRL',
      }),
    );

    const findByIdempotencyKey = vi.fn().mockResolvedValue(existingTransaction);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(findByIdempotencyKey),
      idGenerator,
      clock,
    );

    const result = await useCase.execute(input);

    expect(result).toEqual({
      transactionId: existingTransaction.id,
      status: WagerTransactionStatus.Rejected,
      walletId: input.walletId,
      balance: {
        amount: '20.00',
        currency: 'BRL',
      },
      idempotentReplay: true,
    });

    expect(findByIdempotencyKey).toHaveBeenCalledOnce();
  });
  it('throws WalletNotFoundError when the wallet does not exist', async () => {
    const findByIdempotencyKey = vi.fn().mockResolvedValue(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(null);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(findByIdempotencyKey, findByIdForUpdate),
      idGenerator,
      clock,
    );

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(
      WalletNotFoundError,
    );

    expect(findByIdempotencyKey).toHaveBeenCalledOnce();
    expect(findByIdempotencyKey).toHaveBeenCalledWith(input.idempotencyKey);

    expect(findByIdForUpdate).toHaveBeenCalledOnce();
    expect(findByIdForUpdate).toHaveBeenCalledWith(input.walletId);
  });

  it('returns an idempotent replay when the transaction appears after the wallet lock', async () => {
    const payloadHash = CanonicalPayloadHasher.hash(input);

    const wallet = Wallet.open({
      id: input.walletId,
      playerId: input.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    const concurrentTransaction = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deef38',
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: Money.from(input.money),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    concurrentTransaction.markProcessed(
      undefined,
      Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      new Date('2026-10-05T12:01:00.000Z'),
    );

    const findByIdempotencyKey = vi
      .fn()
      // Primeira consulta: a outra instância ainda não concluiu.
      .mockResolvedValueOnce(null)
      // Após o lock: a outra instância já fez commit.
      .mockResolvedValueOnce(concurrentTransaction);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(findByIdempotencyKey, findByIdForUpdate),
      idGenerator,
      clock,
    );
    const result = await useCase.execute(input);

    expect(result).toEqual({
      transactionId: concurrentTransaction.id,
      status: WagerTransactionStatus.Processed,
      walletId: input.walletId,
      balance: {
        amount: '75.00',
        currency: 'BRL',
      },
      idempotentReplay: true,
    });

    expect(findByIdForUpdate).toHaveBeenCalledOnce();
    expect(findByIdForUpdate).toHaveBeenCalledWith(input.walletId);

    expect(findByIdempotencyKey).toHaveBeenCalledTimes(2);
  });
  it('throws CurrencyMismatchError when transaction currency differs from wallet currency', async () => {
    const wallet = Wallet.open({
      id: input.walletId,
      playerId: input.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    const inputWithDifferentCurrency: ProcessWagerTransactionInput = {
      ...input,
      money: {
        amount: '25.00',
        currency: 'USD',
      },
    };

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(findByIdempotencyKey, findByIdForUpdate),
      idGenerator,
      clock,
    );
    await expect(
      useCase.execute(inputWithDifferentCurrency),
    ).rejects.toBeInstanceOf(CurrencyMismatchError);

    expect(findByIdForUpdate).toHaveBeenCalledOnce();
    expect(findByIdForUpdate).toHaveBeenCalledWith(input.walletId);

    expect(findByIdempotencyKey).toHaveBeenCalledTimes(2);
  });

  it('rejects a BET with insufficient balance without changing the wallet balance', async () => {
    const wallet = Wallet.open({
      id: input.walletId,
      playerId: input.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '20.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);

    const walletSave = vi.fn().mockResolvedValue(undefined);

    const ledgerAppend = vi.fn().mockResolvedValue(undefined);

    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
      ),
      idGenerator,
      clock,
    );

    const result = await useCase.execute(input);

    expect(wagerTransactionSave).toHaveBeenCalledOnce();
    expect(outboxSave).toHaveBeenCalledOnce();

    expect(walletSave).not.toHaveBeenCalled();
    expect(ledgerAppend).not.toHaveBeenCalled();

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    const rejectedEvent = outboxSave.mock.calls[0][0];

    expect(rejectedEvent.eventType).toBe('WagerTransactionRejected');

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Rejected);

    expect(savedTransaction.failureCode).toBe(FailureCode.InsufficientBalance);

    expect(savedTransaction.resultingBalance?.toJSON()).toEqual({
      amount: '20.00',
      currency: 'BRL',
    });

    expect(wallet.balance.toJSON()).toEqual({
      amount: '20.00',
      currency: 'BRL',
    });

    expect(result).toEqual({
      transactionId,
      status: WagerTransactionStatus.Rejected,
      walletId: input.walletId,
      balance: {
        amount: '20.00',
        currency: 'BRL',
      },
      idempotentReplay: false,
    });
  });
  it('processes an accepted BET atomically with wallet, ledger and outbox changes', async () => {
    const wallet = Wallet.open({
      id: input.walletId,
      playerId: input.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: new Date('2026-10-05T12:00:00.000Z'),
    });

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);

    const walletSave = vi.fn().mockResolvedValue(undefined);

    const ledgerAppend = vi.fn().mockResolvedValue(undefined);

    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const betTransactionId = '0192f292-27dd-7d3f-8071-5f8685deef40';
    const ledgerEntryId = '0192f292-27dd-7d3f-8071-5f8685deef41';
    const processedEventId = '0192f292-27dd-7d3f-8071-5f8685deef42';
    const balanceChangedEventId = '0192f292-27dd-7d3f-8071-5f8685deef43';

    const betIdGenerator: IdGenerator = {
      generate: vi
        .fn()
        .mockReturnValueOnce(betTransactionId)
        .mockReturnValueOnce(ledgerEntryId)
        .mockReturnValueOnce(processedEventId)
        .mockReturnValueOnce(balanceChangedEventId),
    };

    const occurredAt = new Date('2026-10-05T12:00:00.000Z');

    const betClock: Clock = {
      now: vi.fn().mockReturnValue(occurredAt),
    };

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
      ),
      betIdGenerator,
      betClock,
    );

    const result = await useCase.execute(input);

    expect(wallet.balance.toJSON()).toEqual({
      amount: '75.00',
      currency: 'BRL',
    });

    expect(wallet.version).toBe(2);

    expect(walletSave).toHaveBeenCalledOnce();
    expect(wagerTransactionSave).toHaveBeenCalledOnce();
    expect(ledgerAppend).toHaveBeenCalledOnce();

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Processed);

    expect(savedTransaction.resultingBalance?.toJSON()).toEqual({
      amount: '75.00',
      currency: 'BRL',
    });

    const ledgerEntry = ledgerAppend.mock.calls[0][0];

    expect(ledgerEntry.id).toBe(ledgerEntryId);
    expect(ledgerEntry.walletId).toBe(input.walletId);
    expect(ledgerEntry.transactionId).toBe(betTransactionId);
    expect(ledgerEntry.direction).toBe('DEBIT');

    expect(ledgerEntry.money.toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });

    expect(ledgerEntry.balanceBefore.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(ledgerEntry.balanceAfter.toJSON()).toEqual({
      amount: '75.00',
      currency: 'BRL',
    });

    expect(outboxSave).toHaveBeenCalledTimes(2);

    const outboxMessages = outboxSave.mock.calls.map(([message]) => message);

    expect(outboxMessages.map((message) => message.eventType)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);

    expect(result).toEqual({
      transactionId: betTransactionId,
      status: WagerTransactionStatus.Processed,
      walletId: input.walletId,
      balance: {
        amount: '75.00',
        currency: 'BRL',
      },
      idempotentReplay: false,
    });
  });
  it('processes a WIN by crediting the wallet and creating ledger and outbox events', async () => {
    const winInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:win-001',
      externalTransactionId: 'win-001',
      kind: WagerTransactionKind.Win,
    };

    const wallet = Wallet.open({
      id: winInput.walletId,
      playerId: winInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const winTransactionId = '0192f292-27dd-7d3f-8071-5f8685deef50';
    const ledgerEntryId = '0192f292-27dd-7d3f-8071-5f8685deef51';
    const processedEventId = '0192f292-27dd-7d3f-8071-5f8685deef52';
    const balanceChangedEventId = '0192f292-27dd-7d3f-8071-5f8685deef53';

    const winIdGenerator: IdGenerator = {
      generate: vi
        .fn()
        .mockReturnValueOnce(winTransactionId)
        .mockReturnValueOnce(ledgerEntryId)
        .mockReturnValueOnce(processedEventId)
        .mockReturnValueOnce(balanceChangedEventId),
    };

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
      ),
      winIdGenerator,
      clock,
    );

    const result = await useCase.execute(winInput);

    expect(wallet.balance.toJSON()).toEqual({
      amount: '125.00',
      currency: 'BRL',
    });

    expect(wallet.version).toBe(2);

    expect(walletSave).toHaveBeenCalledOnce();
    expect(wagerTransactionSave).toHaveBeenCalledOnce();
    expect(ledgerAppend).toHaveBeenCalledOnce();

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Processed);

    expect(savedTransaction.resultingBalance?.toJSON()).toEqual({
      amount: '125.00',
      currency: 'BRL',
    });

    const ledgerEntry = ledgerAppend.mock.calls[0][0];

    expect(ledgerEntry.transactionId).toBe(winTransactionId);
    expect(ledgerEntry.direction).toBe('CREDIT');

    expect(ledgerEntry.money.toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });

    expect(ledgerEntry.balanceBefore.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(ledgerEntry.balanceAfter.toJSON()).toEqual({
      amount: '125.00',
      currency: 'BRL',
    });

    expect(outboxSave).toHaveBeenCalledTimes(2);

    const eventTypes = outboxSave.mock.calls.map(
      ([message]) => message.eventType,
    );

    expect(eventTypes).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);

    expect(result).toEqual({
      transactionId: winTransactionId,
      status: WagerTransactionStatus.Processed,
      walletId: winInput.walletId,
      balance: {
        amount: '125.00',
        currency: 'BRL',
      },
      idempotentReplay: false,
    });
  });
  it('processes a LOSS without changing the wallet or creating a ledger entry', async () => {
    const lossInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:loss-001',
      externalTransactionId: 'loss-001',
      kind: WagerTransactionKind.Loss,
    };

    const wallet = Wallet.open({
      id: lossInput.walletId,
      playerId: lossInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const lossTransactionId = '0192f292-27dd-7d3f-8071-5f8685deef60';
    const processedEventId = '0192f292-27dd-7d3f-8071-5f8685deef61';

    const lossIdGenerator: IdGenerator = {
      generate: vi
        .fn()
        .mockReturnValueOnce(lossTransactionId)
        .mockReturnValueOnce(processedEventId),
    };

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
      ),
      lossIdGenerator,
      clock,
    );

    const result = await useCase.execute(lossInput);

    expect(wallet.balance.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(wallet.version).toBe(1);

    expect(walletSave).not.toHaveBeenCalled();
    expect(ledgerAppend).not.toHaveBeenCalled();

    expect(wagerTransactionSave).toHaveBeenCalledOnce();

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Processed);

    expect(savedTransaction.resultingBalance?.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(outboxSave).toHaveBeenCalledOnce();

    const outboxMessage = outboxSave.mock.calls[0][0];

    expect(outboxMessage.eventType).toBe('WagerTransactionProcessed');

    expect(result).toEqual({
      transactionId: lossTransactionId,
      status: WagerTransactionStatus.Processed,
      walletId: lossInput.walletId,
      balance: {
        amount: '100.00',
        currency: 'BRL',
      },
      idempotentReplay: false,
    });
  });
  it('marks a REFUND as PENDING_REFERENCE when the referenced transaction does not exist yet', async () => {
    const refundInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:refund-001',
      externalTransactionId: 'refund-001',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-original-001',
    };

    const wallet = Wallet.open({
      id: refundInput.walletId,
      playerId: refundInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const findByProviderAndExternalId = vi.fn().mockResolvedValue(null);

    const existsReversal = vi.fn().mockResolvedValue(false);

    const refundTransactionId = '0192f292-27dd-7d3f-8071-5f8685deef70';

    const pendingReferenceEventId = '0192f292-27dd-7d3f-8071-5f8685deef71';

    const refundIdGenerator: IdGenerator = {
      generate: vi
        .fn()
        .mockReturnValueOnce(refundTransactionId)
        .mockReturnValueOnce(pendingReferenceEventId),
    };

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
        findByProviderAndExternalId,
        existsReversal,
      ),
      refundIdGenerator,
      clock,
    );

    const result = await useCase.execute(refundInput);

    expect(findByProviderAndExternalId).toHaveBeenCalledWith(
      refundInput.providerId,
      refundInput.referenceExternalTransactionId,
    );

    expect(existsReversal).not.toHaveBeenCalled();

    expect(wallet.balance.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(wallet.version).toBe(1);

    expect(walletSave).not.toHaveBeenCalled();
    expect(ledgerAppend).not.toHaveBeenCalled();

    expect(wagerTransactionSave).toHaveBeenCalledOnce();

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(
      WagerTransactionStatus.PendingReference,
    );

    expect(savedTransaction.resultingBalance).toBeUndefined();

    expect(outboxSave).toHaveBeenCalledOnce();

    const outboxMessage = outboxSave.mock.calls[0][0];

    expect(outboxMessage.eventType).toBe('WagerTransactionPendingReference');

    expect(result).toBeNull();
  });
  it('processes a REFUND of a processed BET by crediting the wallet', async () => {
    const refundInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:refund-002',
      externalTransactionId: 'refund-002',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-original-002',
    };

    const wallet = Wallet.open({
      id: refundInput.walletId,
      playerId: refundInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    const reference = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deef80',
      providerId: refundInput.providerId,
      externalTransactionId: refundInput.referenceExternalTransactionId!,
      idempotencyKey: 'provider-a:bet-original-002',
      payloadHash: 'reference-hash',
      walletId: refundInput.walletId,
      playerId: refundInput.playerId,
      roundId: refundInput.roundId,
      gameId: refundInput.gameId,
      kind: WagerTransactionKind.Bet,
      money: Money.from(refundInput.money),
      createdAt: now,
    });

    reference.markProcessed(
      undefined,
      Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      now,
    );

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);

    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const findByProviderAndExternalId = vi.fn().mockResolvedValue(reference);

    const existsReversal = vi.fn().mockResolvedValue(false);

    const refundTransactionId = '0192f292-27dd-7d3f-8071-5f8685deef81';

    const ledgerEntryId = '0192f292-27dd-7d3f-8071-5f8685deef82';

    const processedEventId = '0192f292-27dd-7d3f-8071-5f8685deef83';

    const balanceChangedEventId = '0192f292-27dd-7d3f-8071-5f8685deef84';

    const refundIdGenerator: IdGenerator = {
      generate: vi
        .fn()
        .mockReturnValueOnce(refundTransactionId)
        .mockReturnValueOnce(ledgerEntryId)
        .mockReturnValueOnce(processedEventId)
        .mockReturnValueOnce(balanceChangedEventId),
    };

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
        findByProviderAndExternalId,
        existsReversal,
      ),
      refundIdGenerator,
      clock,
    );

    const result = await useCase.execute(refundInput);

    expect(findByProviderAndExternalId).toHaveBeenCalledWith(
      refundInput.providerId,
      refundInput.referenceExternalTransactionId,
    );

    expect(existsReversal).toHaveBeenCalled();

    expect(wallet.balance.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(wallet.version).toBe(2);

    expect(walletSave).toHaveBeenCalledOnce();
    expect(wagerTransactionSave).toHaveBeenCalledOnce();
    expect(ledgerAppend).toHaveBeenCalledOnce();

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Processed);

    expect(savedTransaction.referenceTransactionId).toBe(reference.id);

    expect(savedTransaction.resultingBalance?.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    const ledgerEntry = ledgerAppend.mock.calls[0][0];

    expect(ledgerEntry.direction).toBe('CREDIT');

    expect(ledgerEntry.money.toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });

    expect(ledgerEntry.balanceBefore.toJSON()).toEqual({
      amount: '75.00',
      currency: 'BRL',
    });

    expect(ledgerEntry.balanceAfter.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });

    expect(outboxSave).toHaveBeenCalledTimes(2);

    expect(outboxSave.mock.calls.map(([message]) => message.eventType)).toEqual(
      ['WagerTransactionProcessed', 'WalletBalanceChanged'],
    );

    expect(result).toEqual({
      transactionId: refundTransactionId,
      status: WagerTransactionStatus.Processed,
      walletId: refundInput.walletId,
      balance: {
        amount: '100.00',
        currency: 'BRL',
      },
      idempotentReplay: false,
    });
  });
  it('processes a ROLLBACK of a processed BET by crediting the wallet', async () => {
    const rollbackInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:rollback-bet-001',
      externalTransactionId: 'rollback-bet-001',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'bet-original-003',
    };

    const wallet = Wallet.open({
      id: rollbackInput.walletId,
      playerId: rollbackInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    const reference = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deefa0',
      providerId: rollbackInput.providerId,
      externalTransactionId: rollbackInput.referenceExternalTransactionId!,
      idempotencyKey: 'provider-a:bet-original-003',
      payloadHash: 'reference-hash',
      walletId: rollbackInput.walletId,
      playerId: rollbackInput.playerId,
      roundId: rollbackInput.roundId,
      gameId: rollbackInput.gameId,
      kind: WagerTransactionKind.Bet,
      money: Money.from(rollbackInput.money),
      createdAt: now,
    });

    reference.markProcessed(
      undefined,
      Money.from({ amount: '75.00', currency: 'BRL' }),
      now,
    );

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);
    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const findByProviderAndExternalId = vi.fn().mockResolvedValue(reference);

    const existsReversal = vi.fn().mockResolvedValue(false);

    const ids = [
      '0192f292-27dd-7d3f-8071-5f8685deefa1',
      '0192f292-27dd-7d3f-8071-5f8685deefa2',
      '0192f292-27dd-7d3f-8071-5f8685deefa3',
      '0192f292-27dd-7d3f-8071-5f8685deefa4',
    ];

    const rollbackIdGenerator: IdGenerator = {
      generate: vi
        .fn()
        .mockReturnValueOnce(ids[0])
        .mockReturnValueOnce(ids[1])
        .mockReturnValueOnce(ids[2])
        .mockReturnValueOnce(ids[3]),
    };

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
        findByProviderAndExternalId,
        existsReversal,
      ),
      rollbackIdGenerator,
      clock,
    );

    const result = await useCase.execute(rollbackInput);

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(2);

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Processed);
    expect(savedTransaction.referenceTransactionId).toBe(reference.id);

    const ledgerEntry = ledgerAppend.mock.calls[0][0];

    expect(ledgerEntry.direction).toBe('CREDIT');
    expect(ledgerEntry.balanceBefore.toString()).toBe('75.00');
    expect(ledgerEntry.balanceAfter.toString()).toBe('100.00');

    expect(walletSave).toHaveBeenCalledOnce();
    expect(ledgerAppend).toHaveBeenCalledOnce();
    expect(outboxSave).toHaveBeenCalledTimes(2);

    expect(result?.balance).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });
  });

  it('processes a ROLLBACK of a processed WIN by debiting the wallet', async () => {
    const rollbackInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:rollback-win-001',
      externalTransactionId: 'rollback-win-001',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'win-original-001',
    };

    const wallet = Wallet.open({
      id: rollbackInput.walletId,
      playerId: rollbackInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '125.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    const reference = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deefb0',
      providerId: rollbackInput.providerId,
      externalTransactionId: rollbackInput.referenceExternalTransactionId!,
      idempotencyKey: 'provider-a:win-original-001',
      payloadHash: 'reference-hash',
      walletId: rollbackInput.walletId,
      playerId: rollbackInput.playerId,
      roundId: rollbackInput.roundId,
      gameId: rollbackInput.gameId,
      kind: WagerTransactionKind.Win,
      money: Money.from(rollbackInput.money),
      createdAt: now,
    });

    reference.markProcessed(
      undefined,
      Money.from({ amount: '125.00', currency: 'BRL' }),
      now,
    );

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);
    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const findByProviderAndExternalId = vi.fn().mockResolvedValue(reference);

    const existsReversal = vi.fn().mockResolvedValue(false);

    const rollbackIdGenerator: IdGenerator = {
      generate: vi
        .fn()
        .mockReturnValueOnce('0192f292-27dd-7d3f-8071-5f8685deefb1')
        .mockReturnValueOnce('0192f292-27dd-7d3f-8071-5f8685deefb2')
        .mockReturnValueOnce('0192f292-27dd-7d3f-8071-5f8685deefb3')
        .mockReturnValueOnce('0192f292-27dd-7d3f-8071-5f8685deefb4'),
    };

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
        findByProviderAndExternalId,
        existsReversal,
      ),
      rollbackIdGenerator,
      clock,
    );

    await useCase.execute(rollbackInput);

    expect(wallet.balance.toString()).toBe('100.00');

    const ledgerEntry = ledgerAppend.mock.calls[0][0];

    expect(ledgerEntry.direction).toBe('DEBIT');
    expect(ledgerEntry.balanceBefore.toString()).toBe('125.00');
    expect(ledgerEntry.balanceAfter.toString()).toBe('100.00');

    expect(walletSave).toHaveBeenCalledOnce();
    expect(ledgerAppend).toHaveBeenCalledOnce();
    expect(outboxSave).toHaveBeenCalledTimes(2);
  });

  it('rejects a reversal when the reference was already reversed', async () => {
    const refundInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:refund-duplicate',
      externalTransactionId: 'refund-duplicate',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-already-refunded',
    };

    const wallet = Wallet.open({
      id: refundInput.walletId,
      playerId: refundInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '75.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    const reference = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deefc0',
      providerId: refundInput.providerId,
      externalTransactionId: refundInput.referenceExternalTransactionId!,
      idempotencyKey: 'provider-a:bet-already-refunded',
      payloadHash: 'reference-hash',
      walletId: refundInput.walletId,
      playerId: refundInput.playerId,
      roundId: refundInput.roundId,
      gameId: refundInput.gameId,
      kind: WagerTransactionKind.Bet,
      money: Money.from(refundInput.money),
      createdAt: now,
    });

    reference.markProcessed(
      undefined,
      Money.from({ amount: '75.00', currency: 'BRL' }),
      now,
    );

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);
    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const findByProviderAndExternalId = vi.fn().mockResolvedValue(reference);

    const existsReversal = vi.fn().mockResolvedValue(true);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
        findByProviderAndExternalId,
        existsReversal,
      ),
      idGenerator,
      clock,
    );

    const result = await useCase.execute(refundInput);

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Rejected);

    expect(savedTransaction.failureCode).toBe(
      FailureCode.ReferenceAlreadyReversed,
    );

    expect(savedTransaction.resultingBalance?.toString()).toBe('75.00');

    expect(wallet.balance.toString()).toBe('75.00');
    expect(walletSave).not.toHaveBeenCalled();
    expect(ledgerAppend).not.toHaveBeenCalled();

    expect(result?.status).toBe(WagerTransactionStatus.Rejected);
  });

  it('rejects a ROLLBACK when the debit would make the wallet balance negative', async () => {
    const rollbackInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:rollback-negative',
      externalTransactionId: 'rollback-negative',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'win-original-negative',
    };

    const wallet = Wallet.open({
      id: rollbackInput.walletId,
      playerId: rollbackInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '10.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    const reference = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deefd0',
      providerId: rollbackInput.providerId,
      externalTransactionId: rollbackInput.referenceExternalTransactionId!,
      idempotencyKey: 'provider-a:win-original-negative',
      payloadHash: 'reference-hash',
      walletId: rollbackInput.walletId,
      playerId: rollbackInput.playerId,
      roundId: rollbackInput.roundId,
      gameId: rollbackInput.gameId,
      kind: WagerTransactionKind.Win,
      money: Money.from(rollbackInput.money),
      createdAt: now,
    });

    reference.markProcessed(
      undefined,
      Money.from({ amount: '35.00', currency: 'BRL' }),
      now,
    );

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);
    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const findByProviderAndExternalId = vi.fn().mockResolvedValue(reference);

    const existsReversal = vi.fn().mockResolvedValue(false);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
        findByProviderAndExternalId,
        existsReversal,
      ),
      idGenerator,
      clock,
    );

    const result = await useCase.execute(rollbackInput);

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Rejected);

    expect(savedTransaction.failureCode).toBe(
      FailureCode.ReversalWouldCauseNegativeBalance,
    );

    expect(savedTransaction.resultingBalance?.toString()).toBe('10.00');

    expect(wallet.balance.toString()).toBe('10.00');
    expect(wallet.version).toBe(1);

    expect(walletSave).not.toHaveBeenCalled();
    expect(ledgerAppend).not.toHaveBeenCalled();

    expect(result?.balance).toEqual({
      amount: '10.00',
      currency: 'BRL',
    });
  });
  it('rejects an invalid reference before checking whether it was already reversed', async () => {
    const refundInput: ProcessWagerTransactionInput = {
      ...input,
      idempotencyKey: 'provider-a:refund-invalid-reference',
      externalTransactionId: 'refund-invalid-reference',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'win-invalid-for-refund',
    };

    const wallet = Wallet.open({
      id: refundInput.walletId,
      playerId: refundInput.playerId,
      currency: 'BRL',
      initialBalance: Money.from({
        amount: '100.00',
        currency: 'BRL',
      }),
      createdAt: now,
    });

    // REFUND só pode referenciar BET.
    // Uma WIN deve falhar em validateReference().
    const reference = WagerTransaction.create({
      id: '0192f292-27dd-7d3f-8071-5f8685deefe0',
      providerId: refundInput.providerId,
      externalTransactionId: refundInput.referenceExternalTransactionId!,
      idempotencyKey: 'provider-a:win-invalid-for-refund',
      payloadHash: 'reference-hash',
      walletId: refundInput.walletId,
      playerId: refundInput.playerId,
      roundId: refundInput.roundId,
      gameId: refundInput.gameId,
      kind: WagerTransactionKind.Win,
      money: Money.from(refundInput.money),
      createdAt: now,
    });

    reference.markProcessed(
      undefined,
      Money.from({
        amount: '125.00',
        currency: 'BRL',
      }),
      now,
    );

    const findByIdempotencyKey = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const findByIdForUpdate = vi.fn().mockResolvedValue(wallet);
    const wagerTransactionSave = vi.fn().mockResolvedValue(undefined);
    const walletSave = vi.fn().mockResolvedValue(undefined);
    const ledgerAppend = vi.fn().mockResolvedValue(undefined);
    const outboxSave = vi.fn().mockResolvedValue(undefined);

    const findByProviderAndExternalId = vi.fn().mockResolvedValue(reference);

    const existsReversal = vi.fn().mockResolvedValue(false);

    const useCase = new ProcessWagerTransaction(
      createTransactionManager(
        findByIdempotencyKey,
        findByIdForUpdate,
        wagerTransactionSave,
        walletSave,
        ledgerAppend,
        outboxSave,
        findByProviderAndExternalId,
        existsReversal,
      ),
      idGenerator,
      clock,
    );

    const result = await useCase.execute(refundInput);

    expect(existsReversal).not.toHaveBeenCalled();

    const savedTransaction = wagerTransactionSave.mock.calls[0][0];

    expect(savedTransaction.status).toBe(WagerTransactionStatus.Rejected);

    expect(savedTransaction.failureCode).toBe(FailureCode.InvalidReferenceKind);

    expect(savedTransaction.resultingBalance?.toString()).toBe('100.00');

    expect(wallet.balance.toString()).toBe('100.00');

    expect(walletSave).not.toHaveBeenCalled();
    expect(ledgerAppend).not.toHaveBeenCalled();

    expect(result?.status).toBe(WagerTransactionStatus.Rejected);
  });
});
