import { createHash } from 'node:crypto';

import { InboxMessage } from '../../domain/messaging/inbox-message.js';
import type { Clock } from '../ports/clock.js';
import type { TransactionManager } from '../ports/transaction-manager.js';
import {
  ProcessWagerTransaction,
  type ProcessWagerTransactionInput,
  type ProcessWagerTransactionOutput,
} from './process-wager-transaction.js';

export interface ProcessWagerMessageInput {
  messageId: string;
  wager: ProcessWagerTransactionInput;
}

export interface ProcessWagerMessageOutput {
  wagerResult: ProcessWagerTransactionOutput | null;
  alreadyProcessed: boolean;
}

const CONSUMER_NAME = 'wager-transaction-consumer';

/**
 * Processa uma mensagem de wagering recebida pelo broker.
 *
 * A Inbox e o processamento financeiro compartilham a mesma
 * transação PostgreSQL. O ACK do broker pertence ao consumer
 * e somente deve ocorrer após o retorno bem-sucedido deste use case.
 */
export class ProcessWagerMessage {
  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly processWagerTransaction: ProcessWagerTransaction,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: ProcessWagerMessageInput,
  ): Promise<ProcessWagerMessageOutput> {
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(input.wager))
      .digest('hex');

    return this.transactionManager.transactional(async (context) => {
      const existingMessage = await context.inbox.findByConsumerAndMessageId(
        CONSUMER_NAME,
        input.messageId,
      );

      /*
       * Uma mensagem já concluída pode ter sido entregue novamente
       * porque o worker morreu depois do commit e antes do ACK.
       */
      if (existingMessage?.isProcessed()) {
        if (existingMessage.payloadHash !== payloadHash) {
          throw new Error(
            `Inbox message "${input.messageId}" was redelivered with a different payload`,
          );
        }

        return {
          wagerResult: null,
          alreadyProcessed: true,
        };
      }

      let inboxMessage: InboxMessage;

      if (existingMessage) {
        if (existingMessage.payloadHash !== payloadHash) {
          throw new Error(
            `Inbox message "${input.messageId}" was redelivered with a different payload`,
          );
        }

        inboxMessage = existingMessage;
      } else {
        inboxMessage = InboxMessage.receive({
          messageId: input.messageId,
          consumerName: CONSUMER_NAME,
          payloadHash,
          receivedAt: this.clock.now(),
        });

        await context.inbox.save(inboxMessage);
      }

      /*
       * Reutiliza exatamente o mesmo processamento financeiro usado
       * pela entrada HTTP, mas dentro da transação pertencente à Inbox.
       */
      const wagerResult = await this.processWagerTransaction.executeInContext(
        context,
        input.wager,
      );

      inboxMessage.markProcessed(this.clock.now());

      await context.inbox.save(inboxMessage);

      return {
        wagerResult,
        alreadyProcessed: false,
      };
    });
  }
}
