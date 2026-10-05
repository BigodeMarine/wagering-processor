import type { MoneyProps } from '../../domain/money/money.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../domain/wagering/wager-transaction-status.js';
import { IdempotencyConflictError } from '../errors/idempotency-conflict.error.js';
import { CanonicalPayloadHasher } from '../idempotency/canonical-payload-hasher.js';
import type { TransactionManager } from '../ports/transaction-manager.js';
import type { TransactionContext } from '../ports/transaction-context.js';
import { WalletNotFoundError } from '../errors/wallet-not-found.error.js';
import { CurrencyMismatchError } from '../errors/currency-mismatch.error.js';
import { Money } from '../../domain/money/money.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import { WagerTransactionProcessed } from '../../domain/events/wager-transaction-processed.js';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed.js';
import { WagerTransactionPendingReference } from '../../domain/events/wager-transaction-pending-reference.js';
import { LedgerDirection } from '../../domain/ledger/ledger-direction.js';
import { WagerTransactionRejected } from '../../domain/events/wager-transaction-rejected.js';

export interface ProcessWagerTransactionInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerTransactionOutput {
  transactionId: string;
  status: string;
  walletId: string;
  balance: MoneyProps;
  idempotentReplay: boolean;
}

export class ProcessWagerTransaction {
  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionOutput | null> {
    return this.transactionManager.transactional((context) =>
      this.executeInContext(context, input),
    );
  }

  /**
   * Executa o processamento financeiro utilizando uma transação já existente.
   *
   * Permite que diferentes entradas, como HTTP e SQS, reutilizem a mesma
   * lógica financeira sem criar transações independentes.
   */
  async executeInContext(
    context: TransactionContext,
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionOutput | null> {
    const payloadHash = CanonicalPayloadHasher.hash({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

      const existingTransaction =
        await context.wagerTransaction.findByIdempotencyKey(
          input.idempotencyKey,
        );

      if (!existingTransaction) {
        const wallet = await context.wallet.findByIdForUpdate(input.walletId);

        if (!wallet) {
          throw new WalletNotFoundError(input.walletId);
        }

        /*
         * Outra instância pode ter concluído a mesma operação
         * enquanto aguardávamos o lock da Wallet.
         */
        const transactionAfterLock =
          await context.wagerTransaction.findByIdempotencyKey(
            input.idempotencyKey,
          );

        if (transactionAfterLock) {
          if (!transactionAfterLock.matchesPayload(payloadHash)) {
            throw new IdempotencyConflictError(input.idempotencyKey);
          }

          if (
            transactionAfterLock.status === WagerTransactionStatus.Processed ||
            transactionAfterLock.status === WagerTransactionStatus.Rejected
          ) {
            const resultingBalance = transactionAfterLock.resultingBalance;

            if (!resultingBalance) {
              throw new Error(
                `Terminal transaction "${transactionAfterLock.id}" is missing resultingBalance`,
              );
            }

            return {
              transactionId: transactionAfterLock.id,
              status: transactionAfterLock.status,
              walletId: transactionAfterLock.walletId,
              balance: resultingBalance.toJSON(),
              idempotentReplay: true,
            };
          }

          return null;
        }
        if (input.money.currency !== wallet.currency) {
          throw new CurrencyMismatchError(
            wallet.currency,
            input.money.currency,
          );
        }
        const transaction = WagerTransaction.create({
          id: this.idGenerator.generate(),
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
          referenceExternalTransactionId: input.referenceExternalTransactionId,
          createdAt: this.clock.now(),
        });

        if (
          transaction.kind === WagerTransactionKind.Bet &&
          wallet.balance.islessThan(transaction.money)
        ) {
          transaction.reject(FailureCode.InsufficientBalance, wallet.balance);
          const rejectedEvent = new WagerTransactionRejected({
            eventId: this.idGenerator.generate(),
            aggregateId: transaction.id,
            correlationId: transaction.id,
            occurredAt: this.clock.now(),
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
              failureCode: FailureCode.InsufficientBalance,
            },
          });

          await context.wagerTransaction.save(transaction);

          await context.outbox.save(OutboxMessage.enqueue(rejectedEvent));

          return {
            transactionId: transaction.id,
            status: transaction.status,
            walletId: transaction.walletId,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }

        // BET com saldo suficiente.
        if (transaction.kind === WagerTransactionKind.Bet) {
          const occurredAt = this.clock.now();

          const movement = wallet.debit(transaction.money, occurredAt);

          if (movement === null) {
            throw new Error('BET must produce a wallet movement');
          }

          transaction.markProcessed(undefined, wallet.balance, occurredAt);

          const ledgerEntry = WalletLedgerEntry.create({
            id: this.idGenerator.generate(),
            walletId: wallet.id,
            transactionId: transaction.id,
            movement,
            createdAt: occurredAt,
          });

          const processedEvent = new WagerTransactionProcessed({
            eventId: this.idGenerator.generate(),
            aggregateId: transaction.id,
            correlationId: transaction.id,
            occurredAt,
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

          const balanceChangedEvent = WalletBalanceChanged.from(
            wallet,
            ledgerEntry,
            {
              eventId: this.idGenerator.generate(),
              correlationId: transaction.id,
              causationId: processedEvent.eventId,
              occurredAt,
            },
          );

          await context.wallet.save(wallet);
          await context.wagerTransaction.save(transaction);
          await context.ledger.append(ledgerEntry);

          await context.outbox.save(OutboxMessage.enqueue(processedEvent));

          await context.outbox.save(OutboxMessage.enqueue(balanceChangedEvent));

          return {
            transactionId: transaction.id,
            status: transaction.status,
            walletId: transaction.walletId,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }

        // WIN credita o valor na Wallet e registra a movimentação no Ledger.
        if (transaction.kind === WagerTransactionKind.Win) {
          const occurredAt = this.clock.now();

          const movement = wallet.credit(transaction.money, occurredAt);

          if (movement === null) {
            throw new Error('WIN must produce a wallet movement');
          }

          transaction.markProcessed(undefined, wallet.balance, occurredAt);

          const ledgerEntry = WalletLedgerEntry.create({
            id: this.idGenerator.generate(),
            walletId: wallet.id,
            transactionId: transaction.id,
            movement,
            createdAt: occurredAt,
          });

          const processedEvent = new WagerTransactionProcessed({
            eventId: this.idGenerator.generate(),
            aggregateId: transaction.id,
            correlationId: transaction.id,
            occurredAt,
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

          const balanceChangedEvent = WalletBalanceChanged.from(
            wallet,
            ledgerEntry,
            {
              eventId: this.idGenerator.generate(),
              correlationId: transaction.id,
              causationId: processedEvent.eventId,
              occurredAt,
            },
          );

          await context.wallet.save(wallet);
          await context.wagerTransaction.save(transaction);
          await context.ledger.append(ledgerEntry);

          await context.outbox.save(OutboxMessage.enqueue(processedEvent));

          await context.outbox.save(OutboxMessage.enqueue(balanceChangedEvent));

          return {
            transactionId: transaction.id,
            status: transaction.status,
            walletId: transaction.walletId,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }

        // LOSS registra o resultado, mas não altera o saldo da Wallet.
        if (transaction.kind === WagerTransactionKind.Loss) {
          const occurredAt = this.clock.now();

          transaction.markProcessed(undefined, wallet.balance, occurredAt);

          const processedEvent = new WagerTransactionProcessed({
            eventId: this.idGenerator.generate(),
            aggregateId: transaction.id,
            correlationId: transaction.id,
            occurredAt,
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

          await context.wagerTransaction.save(transaction);

          await context.outbox.save(OutboxMessage.enqueue(processedEvent));

          return {
            transactionId: transaction.id,
            status: transaction.status,
            walletId: transaction.walletId,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }
        if (
          transaction.kind === WagerTransactionKind.Refund ||
          transaction.kind === WagerTransactionKind.Rollback
        ) {
          const referenceExternalTransactionId =
            transaction.referenceExternalTransactionId;

          if (!referenceExternalTransactionId) {
            throw new Error(
              `${transaction.kind} requires referenceExternalTransactionId`,
            );
          }

          const reference =
            await context.wagerTransaction.findByProviderAndExternalId(
              transaction.providerId,
              referenceExternalTransactionId,
            );

          if (!reference) {
            transaction.markPendingReference();

            const pendingReferenceEvent = new WagerTransactionPendingReference({
              eventId: this.idGenerator.generate(),
              aggregateId: transaction.id,
              correlationId: transaction.id,
              occurredAt: this.clock.now(),
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
                referenceExternalTransactionId,
              },
            });

            await context.wagerTransaction.save(transaction);

            await context.outbox.save(
              OutboxMessage.enqueue(pendingReferenceEvent),
            );

            return null;
          }

          const referenceFailure = transaction.validateReference(reference);

          if (referenceFailure) {
            transaction.reject(referenceFailure, wallet.balance);

            const rejectedEvent = new WagerTransactionRejected({
              eventId: this.idGenerator.generate(),
              aggregateId: transaction.id,
              correlationId: transaction.id,
              occurredAt: this.clock.now(),
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
                failureCode: referenceFailure,
              },
            });

            await context.wagerTransaction.save(transaction);

            await context.outbox.save(OutboxMessage.enqueue(rejectedEvent));

            return {
              transactionId: transaction.id,
              status: transaction.status,
              walletId: transaction.walletId,
              balance: wallet.balance.toJSON(),
              idempotentReplay: false,
            };
          }

          const alreadyReversed = await context.wagerTransaction.existsReversal(
            reference.id,
            transaction.kind,
          );

          if (alreadyReversed) {
            transaction.reject(
              FailureCode.ReferenceAlreadyReversed,
              wallet.balance,
            );

            const rejectedEvent = new WagerTransactionRejected({
              eventId: this.idGenerator.generate(),
              aggregateId: transaction.id,
              correlationId: transaction.id,
              occurredAt: this.clock.now(),
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
                failureCode: FailureCode.ReferenceAlreadyReversed,
              },
            });

            await context.wagerTransaction.save(transaction);

            await context.outbox.save(OutboxMessage.enqueue(rejectedEvent));

            return {
              transactionId: transaction.id,
              status: transaction.status,
              walletId: transaction.walletId,
              balance: wallet.balance.toJSON(),
              idempotentReplay: false,
            };
          }

          const direction = transaction.ledgerDirectionFor(reference);

          if (!direction) {
            throw new Error(
              `${transaction.kind} must produce a ledger direction`,
            );
          }

          const occurredAt = this.clock.now();

          let movement;

          if (direction === LedgerDirection.Credit) {
            movement = wallet.credit(transaction.money, occurredAt);
          } else {
            if (wallet.balance.islessThan(transaction.money)) {
              transaction.reject(
                FailureCode.ReversalWouldCauseNegativeBalance,
                wallet.balance,
              );

              const rejectedEvent = new WagerTransactionRejected({
                eventId: this.idGenerator.generate(),
                aggregateId: transaction.id,
                correlationId: transaction.id,
                occurredAt: this.clock.now(),
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
                  failureCode: FailureCode.ReversalWouldCauseNegativeBalance,
                },
              });

              await context.wagerTransaction.save(transaction);

              await context.outbox.save(OutboxMessage.enqueue(rejectedEvent));

              return {
                transactionId: transaction.id,
                status: transaction.status,
                walletId: transaction.walletId,
                balance: wallet.balance.toJSON(),
                idempotentReplay: false,
              };
            }

            movement = wallet.debit(transaction.money, occurredAt);
          }

          if (movement === null) {
            throw new Error(
              `${transaction.kind} must produce a wallet movement`,
            );
          }

          transaction.markProcessed(reference.id, wallet.balance, occurredAt);

          const ledgerEntry = WalletLedgerEntry.create({
            id: this.idGenerator.generate(),
            walletId: wallet.id,
            transactionId: transaction.id,
            movement,
            createdAt: occurredAt,
          });

          const processedEvent = new WagerTransactionProcessed({
            eventId: this.idGenerator.generate(),
            aggregateId: transaction.id,
            correlationId: transaction.id,
            occurredAt,
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

          const balanceChangedEvent = WalletBalanceChanged.from(
            wallet,
            ledgerEntry,
            {
              eventId: this.idGenerator.generate(),
              correlationId: transaction.id,
              causationId: processedEvent.eventId,
              occurredAt,
            },
          );

          await context.wallet.save(wallet);
          await context.wagerTransaction.save(transaction);
          await context.ledger.append(ledgerEntry);

          await context.outbox.save(OutboxMessage.enqueue(processedEvent));

          await context.outbox.save(OutboxMessage.enqueue(balanceChangedEvent));

          return {
            transactionId: transaction.id,
            status: transaction.status,
            walletId: transaction.walletId,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }
      
        return null;
      }

      if (!existingTransaction.matchesPayload(payloadHash)) {
        throw new IdempotencyConflictError(input.idempotencyKey);
      }

      if (
        existingTransaction.status === WagerTransactionStatus.Processed ||
        existingTransaction.status === WagerTransactionStatus.Rejected
      ) {
        const resultingBalance = existingTransaction.resultingBalance;

        if (!resultingBalance) {
          throw new Error(
            `Terminal transaction "${existingTransaction.id}" is missing resultingBalance`,
          );
        }

        return {
          transactionId: existingTransaction.id,
          status: existingTransaction.status,
          walletId: existingTransaction.walletId,
          balance: resultingBalance.toJSON(),
          idempotentReplay: true,
        };
      }

      return null;
  }
}
