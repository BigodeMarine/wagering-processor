import type { TransactionContext } from './transaction-context.js';

/**
 * Executa operações da camada de aplicação dentro de uma única
 * transação SQL.
 * A implementação de infraestrutura é responsável por criar o
 * contexto transacional, executar o trabalho e realizar commit
 * ou rollback.
 */
export interface TransactionManager {
  transactional<T>(
    work: (context: TransactionContext) => Promise<T>,
  ): Promise<T>;
}