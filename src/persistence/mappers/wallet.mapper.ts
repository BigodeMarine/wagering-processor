import { Money } from '../../domain/money/money.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { WalletEntity } from '../entities/wallet.entity.js';

/**
 * Converte Wallet entre as representações de domínio e persistência.
 */
export class WalletMapper {
  /**
   * Reconstrói o agregado de domínio a partir do estado persistido.
   */
  static toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.from({
        amount: entity.balance,
        currency: entity.currency,
      }),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  /**
   * Converte o agregado para sua representação persistível.
   */
  static toPersistence(wallet: Wallet): WalletEntity {
    const entity = new WalletEntity();

    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = wallet.balance.toString();
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;

    return entity;
  }
  /**
   * Atualiza uma entidade já gerenciada pelo MikroORM
   * com o estado atual do agregado de domínio.
   *
   * Preserva a identidade da entidade carregada pela transação,
   * permitindo que o Unit of Work gere UPDATE em vez de INSERT.
   */
  static updatePersistence(entity: WalletEntity, wallet: Wallet): void {
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balance = wallet.balance.toString();
    entity.version = wallet.version;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;
  }
}
