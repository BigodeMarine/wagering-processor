import type { WagerTransaction } from '../../../domain/wagering/wager-transaction.js';
import type { WagerTransactionKind } from '../../../domain/wagering/wager-transaction-kind.js';

/**
 * Contrato de persistência utilizado pela camada de aplicação
 * para consultar e persistir transações de wagering.
 */
export interface WagerTransactionRepository {
  /**
   * Busca uma transação pelo identificador interno.
   */
  findById(transactionId: string): Promise<WagerTransaction | null>;

  /**
   * Busca uma transação pela chave de idempotência.
   * Utilizado para detectar replays antes de executar novamente
   * uma operação financeira.
   */
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | null>;

  /**
   * Busca uma transação pelo identificador externo atribuído
   * pelo provider.
   */
  findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;

  /**
   * Verifica se uma referência já foi revertida pelo mesmo
   * tipo de operação.
   */
  existsReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean>;

  /**
   * Persiste uma transação de wagering.
   */
  save(transaction: WagerTransaction): Promise<void>;
}
