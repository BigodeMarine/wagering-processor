import type { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry.js';

/**
 * Contrato de persistência para o histórico financeiro das carteiras.
 * O Ledger é append-only: lançamentos podem ser adicionados e
 * consultados, mas nunca alterados ou removidos.
 */
export interface WalletLedgerRepository {
  /**
   * Adiciona um novo lançamento ao histórico financeiro.
   */
  append(entry: WalletLedgerEntry): Promise<void>;

  /**
   * Busca o lançamento associado a uma transação específica
   * dentro de uma carteira.
   */
  findByWalletAndTransaction(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | null>;
}