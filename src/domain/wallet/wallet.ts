import { Money } from '../money/money.js';
import type { WalletMovement } from './wallet-movement.js';

export interface OpenWalletProps {
  id: string;
  playerId: string;
  currency: string;
  initialBalance: Money;
  createdAt: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate Root responsável pelo saldo de um jogador
 * em uma determinada moeda.
 *
 * O saldo somente pode ser alterado por operações controladas
 * pelo próprio agregado.
 */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  /**
   * Abre uma nova wallet.
   *
   * Uma wallet recém-criada começa na versão 1.
   */
  static open(props: OpenWalletProps): Wallet {
    Wallet.assertSameCurrency(props.currency, props.initialBalance);

    if (props.initialBalance.isNegative()) {
      throw new Error('Wallet balance cannot be negative');
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.currency,
      props.initialBalance,
      1,
      props.createdAt,
      props.createdAt,
    );
  }

  /**
   * Reconstrói uma wallet a partir do estado persistido.
   *
   * Não reaplica transições de domínio.
   */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Debita um valor e retorna a movimentação necessária
   * para criação do lançamento correspondente no ledger.
   */
  debit(amount: Money, occurredAt: Date): WalletMovement | null {
    this.assertSameCurrency(amount);

    if (amount.isZero()) {
      return null;
    }

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(amount);

    if (balanceAfter.isNegative()) {
      throw new Error('Insufficient balance');
    }

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = occurredAt;

    return Object.freeze({
      direction: 'DEBIT',
      amount,
      balanceBefore,
      balanceAfter,
    });
  }

  /**
   * Credita um valor e retorna a movimentação necessária
   * para criação do lançamento correspondente no ledger.
   */
  credit(amount: Money, occurredAt: Date): WalletMovement | null {
    this.assertSameCurrency(amount);

    if (amount.isZero()) {
      return null;
    }

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(amount);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = occurredAt;

    return Object.freeze({
      direction: 'CREDIT',
      amount,
      balanceBefore,
      balanceAfter,
    });
  }

  private assertSameCurrency(money: Money): void {
    Wallet.assertSameCurrency(this.currency, money);
  }

  private static assertSameCurrency(currency: string, money: Money): void {
    if (money.currency !== currency) {
      throw new Error(
        `Currency mismatch: wallet uses ${currency}, money uses ${money.currency}`,
      );
    }
  }
}
