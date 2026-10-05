import { Money } from '../../domain/money/money.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';

import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { TransactionManager } from '../ports/transaction-manager.js';

export interface CreateWalletInput {
  playerId: string;
  currency: string;
  initialBalance: string;
}

export interface CreateWalletOutput {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: Date;
}

export class CreateWallet {
  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateWalletInput): Promise<CreateWalletOutput> {
    const now = this.clock.now();
    const walletId = this.idGenerator.generate();

    const initialBalance = Money.from({
      amount: input.initialBalance,
      currency: input.currency,
    });

    return this.transactionManager.transactional(async (context) => {
      /*
       * A wallet nasce com saldo zero.
       *
       * Quando existe saldo inicial, ele é aplicado como uma movimentação
       * financeira explícita para que OPENING e Ledger representem
       * corretamente a transição 0 -> initialBalance.
       */
      const wallet = Wallet.open({
        id: walletId,
        playerId: input.playerId,
        currency: input.currency,
        initialBalance: Money.zero(input.currency),
        createdAt: now,
      });

      if (initialBalance.isPositive()) {
        const transactionId = this.idGenerator.generate();

        /*
         * OPENING é uma operação interna. A chave de idempotência e o
         * externalTransactionId são derivados da própria wallet, pois
         * essa transação não é fornecida por um provider externo.
         */
        const openingTransaction = WagerTransaction.create({
          id: transactionId,
          providerId: 'SYSTEM',
          externalTransactionId: `opening:${walletId}`,
          idempotencyKey: `opening:${walletId}`,
          payloadHash: `opening:${walletId}`,
          walletId,
          playerId: input.playerId,
          roundId: `opening:${walletId}`,
          gameId: 'SYSTEM',
          kind: WagerTransactionKind.Opening,
          money: initialBalance,
          createdAt: now,
        });

        const movement = wallet.credit(initialBalance, now);

        if (!movement) {
          throw new Error('Opening balance must produce a wallet movement');
        }

        openingTransaction.markProcessed(undefined, wallet.balance, now);

        const ledgerEntry = WalletLedgerEntry.create({
          id: this.idGenerator.generate(),
          walletId,
          transactionId,
          movement,
          createdAt: now,
        });

        await context.wagerTransaction.save(openingTransaction);
        await context.ledger.append(ledgerEntry);
      }

      await context.wallet.save(wallet);

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance.toString(),
        version: wallet.version,
        createdAt: wallet.createdAt,
      };
    });
  }
}
