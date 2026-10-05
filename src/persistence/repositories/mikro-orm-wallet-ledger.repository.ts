import type { EntityManager } from '@mikro-orm/postgresql';
import type { WalletLedgerRepository } from '../../application/ports/repositories/wallet-ledger.repository.js';
import type { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.js';

/**
 * Implementação MikroORM do repositório de WalletLedgerEntry.
 * O Ledger é append-only: novos lançamentos podem ser adicionados
 * e consultados, mas nunca alterados ou removidos.
 */
export class MikroOrmWalletLedgerRepository implements WalletLedgerRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Adiciona um novo lançamento ao histórico financeiro.
   * O flush é controlado pela fronteira transacional.
   */
  async append(entry: WalletLedgerEntry): Promise<void> {
    const entity = WalletLedgerEntryMapper.toPersistence(entry);

    this.em.persist(entity);
  }

  /**
   * Busca o lançamento associado a uma transação específica
   * dentro de uma carteira.
   */
  async findByWalletAndTransaction(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | null> {
    const entity = await this.em.findOne(WalletLedgerEntryEntity, {
      wallet: walletId,
      transaction: transactionId,
    });

    return entity ? WalletLedgerEntryMapper.toDomain(entity) : null;
  }
}
