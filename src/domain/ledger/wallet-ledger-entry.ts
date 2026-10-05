import { Money } from '../money/money.js';
import type { WalletMovement } from '../wallet/wallet-movement.js';
import { LedgerDirection } from './ledger-direction.js';

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  movement: WalletMovement;
  createdAt: Date;
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

/**
 * Registro imutável de uma movimentação financeira da wallet.
 *
 * Não possui campos mutáveis nem métodos de transição.
 */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  /**
   * Cria um lançamento e garante que sua aritmética seja válida.
   */
  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const direction =
      props.movement.direction === 'DEBIT'
        ? LedgerDirection.Debit
        : LedgerDirection.Credit;

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      direction,
      props.movement.amount,
      props.movement.balanceBefore,
      props.movement.balanceAfter,
      props.createdAt,
    );

    if (!entry.isBalanced()) {
      throw new Error('Invalid ledger arithmetic');
    }

    return entry;
  }

  /**
   * Reconstrói um lançamento previamente persistido.
   *
   * Não reaplica as regras de criação.
   */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  /**
   * Verifica se:
   * DEBIT:  balanceBefore - money = balanceAfter
   * CREDIT: balanceBefore + money = balanceAfter
   */
  isBalanced(): boolean {
    const expectedBalance =
      this.direction === LedgerDirection.Debit
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);

    return expectedBalance.equals(this.balanceAfter);
  }
}
