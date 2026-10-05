import { createHash } from 'node:crypto';

import type { MoneyProps } from '../../domain/money/money.js';
import type { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';

export interface WagerTransactionPayload {
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

/**
 * Produz uma representação canônica do comando de wagering e calcula
 * seu SHA-256 para validação de idempotência financeira.
 */
export class CanonicalPayloadHasher {
  static hash(payload: WagerTransactionPayload): string {
    const canonicalPayload = {
      providerId: payload.providerId,
      externalTransactionId: payload.externalTransactionId,
      playerId: payload.playerId,
      walletId: payload.walletId,
      roundId: payload.roundId,
      gameId: payload.gameId,
      kind: payload.kind,
      money: {
        amount: payload.money.amount,
        currency: payload.money.currency,
      },
      referenceExternalTransactionId:
        payload.referenceExternalTransactionId ?? null,
    };

    const serializedPayload = JSON.stringify(canonicalPayload);

    return createHash('sha256')
      .update(serializedPayload, 'utf8')
      .digest('hex');
  }
}