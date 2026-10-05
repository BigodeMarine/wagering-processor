import { Money } from '../../domain/money/money.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../domain/wagering/wager-transaction-status.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';
import { rel } from '@mikro-orm/core';
import { WalletEntity } from '../entities/wallet.entity.js';

/**
 * Converte WagerTransaction entre domínio e persistência.
 */
export class WagerTransactionMapper {
  /**
   * Reconstrói a transação de domínio a partir do estado persistido.
   */
  static toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.wallet.id,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind as WagerTransactionKind,
      money: Money.from({
        amount: entity.amount,
        currency: entity.currency,
      }),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      referenceTransactionId: entity.referenceTransactionId,
      status: entity.status as WagerTransactionStatus,
      failureCode: entity.failureCode as FailureCode | undefined,
      createdAt: entity.createdAt,
      processedAt: entity.processedAt,
      resultingBalance: entity.resultingBalance
        ? Money.from({
            amount: entity.resultingBalance,
            currency: entity.currency,
          })
        : undefined,
    });
  }

  /**
   * Converte a transação de domínio para sua representação persistível.
   */
  static toPersistence(transaction: WagerTransaction): WagerTransactionEntity {
    const entity = new WagerTransactionEntity();

    entity.id = transaction.id;
    entity.providerId = transaction.providerId;
    entity.externalTransactionId = transaction.externalTransactionId;
    entity.idempotencyKey = transaction.idempotencyKey;
    entity.payloadHash = transaction.payloadHash;

    entity.wallet = rel(WalletEntity, transaction.walletId);
    entity.playerId = transaction.playerId;
    entity.roundId = transaction.roundId;
    entity.gameId = transaction.gameId;

    entity.kind = transaction.kind;

    entity.amount = transaction.money.toString();
    entity.currency = transaction.money.currency;

    entity.referenceExternalTransactionId =
      transaction.referenceExternalTransactionId;

    entity.referenceTransactionId = transaction.referenceTransactionId;

    entity.status = transaction.status;
    entity.failureCode = transaction.failureCode;

    entity.createdAt = transaction.createdAt;
    entity.processedAt = transaction.processedAt;
    entity.resultingBalance = transaction.resultingBalance?.toString();

    return entity;
  }
}
