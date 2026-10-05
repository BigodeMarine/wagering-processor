import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionContext } from '../application/ports/transaction-context.js';
import type { TransactionManager } from '../application/ports/transaction-manager.js';
import { MikroOrmInboxRepository } from './repositories/mikro-orm-inbox.repository.js';
import { MikroOrmOutboxRepository } from './repositories/mikro-orm-outbox.repository.js';
import { MikroOrmWagerTransactionRepository } from './repositories/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletLedgerRepository } from './repositories/mikro-orm-wallet-ledger.repository.js';
import { MikroOrmWalletRepository } from './repositories/mikro-orm-wallet.repository.js';

/**
 * Implementação do TransactionManager utilizando o Unit of Work
 * e o controle transacional do MikroORM.
 */
export class MikroOrmTransactionManager implements TransactionManager {
  constructor(private readonly em: EntityManager) {}

  /**
   * Executa o trabalho dentro de uma única transação SQL.
   *
   * Todos os repositories do contexto compartilham o mesmo
   * EntityManager transacional.
   */
  async transactional<T>(
    work: (context: TransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.em.transactional(async (transactionalEm) => {
      const context: TransactionContext = {
        wallet: new MikroOrmWalletRepository(transactionalEm),
        wagerTransaction: new MikroOrmWagerTransactionRepository(
          transactionalEm,
        ),
        ledger: new MikroOrmWalletLedgerRepository(transactionalEm),
        inbox: new MikroOrmInboxRepository(transactionalEm),
        outbox: new MikroOrmOutboxRepository(transactionalEm),
      };

      return work(context);
    });
  }
}
