import type { Wallet } from '../../../domain/wallet/wallet.js';

/**
 * Contrato de persistência utilizado pela camada de aplicação
 * para acessar e persistir carteiras.
 * A implementação concreta pode estar associada a um contexto
 * transacional, sem expor detalhes do mecanismo de persistência.
 */
export interface WalletRepository {
  /**
   * Busca uma carteira pelo identificador.
   */
  findById(walletId: string): Promise<Wallet | null>;

  /**
   * Busca uma carteira aplicando lock pessimista para atualização.
   * Deve ser utilizado em operações financeiras que alteram o saldo,
   * garantindo serialização das transações da mesma carteira.
   */
  findByIdForUpdate(walletId: string): Promise<Wallet | null>;

  /**
   * Persiste o estado atual da carteira.
   */
  save(wallet: Wallet): Promise<void>;
}
