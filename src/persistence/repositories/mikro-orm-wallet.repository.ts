import { LockMode, type EntityManager } from '@mikro-orm/postgresql';

import type { WalletRepository } from '../../application/ports/repositories/wallet.repository.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import { WalletEntity } from '../entities/wallet.entity.js';
import { WalletMapper } from '../mappers/wallet.mapper.js';

/**
 * Implementação MikroORM do repositório de Wallet.
 * A instância recebe um EntityManager específico, permitindo que
 * seja vinculada ao contexto transacional criado pela infraestrutura.
 */
export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Busca uma carteira sem adquirir lock de escrita.
   */
  async findById(walletId: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, {
      id: walletId,
    });

    return entity ? WalletMapper.toDomain(entity) : null;
  }

  /**
   * Busca uma carteira utilizando lock pessimista de escrita.
   * O lock permanece ativo até o commit ou rollback da transação,
   * serializando operações financeiras sobre a mesma carteira.
   */
  async findByIdForUpdate(walletId: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(
      WalletEntity,
      { id: walletId },
      {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      },
    );

    return entity ? WalletMapper.toDomain(entity) : null;
  }

  /**
   * Persiste o estado atual da carteira.
   */
  async save(wallet: Wallet): Promise<void> {
    const existingEntity = await this.em.findOne(WalletEntity, {
      id: wallet.id,
    });

    if (existingEntity) {
      WalletMapper.updatePersistence(existingEntity, wallet);
      return;
    }

    const entity = WalletMapper.toPersistence(wallet);

    this.em.persist(entity);
  }
}
