import type { WagerTransactionStatus } from './wager-transaction-status.js';

/**
 * Indica uma tentativa inválida de transição de estado.
 * Um erro de programação, não uma rejeição de negócio.
 */
export class InvalidTransactionStateError extends Error {
  constructor(
    currentStatus: WagerTransactionStatus,
    targetStatus: WagerTransactionStatus,
  ) {
    super(
      `Invalid transaction state transition: ${currentStatus} -> ${targetStatus}`,
    );

    this.name = 'InvalidTransactionStateError';
  }
}
