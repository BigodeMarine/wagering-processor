import type { EntityManager } from '@mikro-orm/postgresql';
import type { WagerTransactionRepository } from '../../application/ports/repositories/wager-transaction.repository.js';
import type { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import type { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper.js';

/**
 * Implementação MikroORM do repositório de WagerTransaction.
 * A instância utiliza o EntityManager associado ao contexto
 * transacional corrente.
 */
export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Busca uma transação pelo identificador interno.
   */
  async findById(transactionId: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      id: transactionId,
    });

    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  /**
   * Busca uma transação pela chave persistente de idempotência.
   */
  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      idempotencyKey,
    });

    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  /**
   * Busca uma transação pelo identificador atribuído pelo provider.
   * Também é utilizado para resolver referências externas de
   * REFUND e ROLLBACK.
   */
  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });

    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  /**
   * Verifica se uma transação de referência já possui uma reversão
   * do mesmo tipo.
   * A constraint única parcial no PostgreSQL continua sendo a
   * garantia final contra condições de corrida.
   */
  async existsReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean> {
    const count = await this.em.count(WagerTransactionEntity, {
      referenceTransactionId,
      kind,
    });

    return count > 0;
  }

  /**
   * Persiste o estado da transação.
   * O flush é controlado pela fronteira transacional.
   */
  async save(transaction: WagerTransaction): Promise<void> {
    const entity = WagerTransactionMapper.toPersistence(transaction);

    this.em.persist(entity);
  }
}
