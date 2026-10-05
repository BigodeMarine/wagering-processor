import type { WalletRepository } from './repositories/wallet.repository.js';
import type { WagerTransactionRepository } from './repositories/wager-transaction.repository.js';
import type { WalletLedgerRepository } from './repositories/wallet-ledger.repository.js';
import type { InboxRepository } from './repositories/inbox.repository.js';
import type { OutboxRepository } from './repositories/outbox.repository.js';

/**
 * Conjunto de repositories associados à mesma transação SQL.
 * Todos os repositories presentes neste contexto devem utilizar
 * o mesmo contexto transacional da infraestrutura.
 */
export interface TransactionContext {
  wallet: WalletRepository;
  wagerTransaction: WagerTransactionRepository;
  ledger: WalletLedgerRepository;
  inbox: InboxRepository;
  outbox: OutboxRepository;
}