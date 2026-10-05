import { WagerTransactionKind } from '../../../../domain/wagering/wager-transaction-kind.js';

export class ProcessWagerTransactionDto {
  providerId!: string;
  externalTransactionId!: string;
  playerId!: string;
  walletId!: string;
  roundId!: string;
  gameId!: string;
  kind!: WagerTransactionKind;

  money!: {
    amount: string;
    currency: string;
  };

  referenceExternalTransactionId?: string;
}
