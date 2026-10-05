import type { MoneyProps } from '../money/money.js';
import type { FailureCode } from '../wagering/failure-code.js';
import type { WagerTransactionKind } from '../wagering/wager-transaction-kind.js';
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from './integration-event.js';

export interface WagerTransactionRejectedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  failureCode: FailureCode;
}

/**
 * Evento emitido quando uma transação é rejeitada por regra de negócio.
 */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }
}
