import type { Money } from '../money/money.js';

export type WalletMovementDirection = 'DEBIT' | 'CREDIT';

/**
 * Representa o resultado imutável de uma alteração de saldo.
 * Esse objeto fornece os dados necessários para que um
 * WalletLedgerEntry seja criado para a mesma movimentação.
 */
export interface WalletMovement {
  readonly direction: WalletMovementDirection;
  readonly amount: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
}
