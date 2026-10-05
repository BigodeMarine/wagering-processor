import type { MoneyProps } from '../../../domain/money/money.js';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction-kind.js';

/**
 * Contrato da mensagem recebida pela fila wager-transactions.fifo.
 *
 * Representa uma solicitação assíncrona para executar uma operação
 * financeira de wagering.
 */
export interface WagerTransactionRequested {
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