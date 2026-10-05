import type { TransactionManager } from '../ports/transaction-manager.js';

export interface GetWalletOutput {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class GetWallet {
  constructor(private readonly transactionManager: TransactionManager) {}

  async execute(walletId: string): Promise<GetWalletOutput | null> {
    return this.transactionManager.transactional(async (context) => {
      const wallet = await context.wallet.findById(walletId);

      if (!wallet) {
        return null;
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance.toString(),
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      };
    });
  }
}
