import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';

import { ProcessWagerMessage } from '../../../application/use-cases/process-wager-message.js';
import type { WagerTransactionRequested } from './wager-transaction-requested.message.js';
import {
  ensureWageringQueues,
  getWageringQueueUrl,
  sqsClient,
} from './sqs.config.js';

@Injectable()
export class WagerTransactionConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WagerTransactionConsumer.name);

  private running = false;
  private pollingPromise?: Promise<void>;
  private queueUrl?: string;

  constructor(private readonly processWagerMessage: ProcessWagerMessage) {}

  async onApplicationBootstrap(): Promise<void> {
    await ensureWageringQueues();

    this.queueUrl = await getWageringQueueUrl();
    this.running = true;

    this.pollingPromise = this.poll();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;

    await this.pollingPromise;
  }

  /**
   * Continuously polls the wagering input queue while the application
   * is running.
   */
  private async poll(): Promise<void> {
    if (!this.queueUrl) {
      throw new Error('Wagering queue URL is not initialized');
    }

    while (this.running) {
      try {
        const response = await sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 10,
            VisibilityTimeout: Number(
              process.env.SQS_VISIBILITY_TIMEOUT_SECONDS ?? 30,
            ),
          }),
        );

        for (const message of response.Messages ?? []) {
          if (!this.running) {
            return;
          }

          await this.processMessage(message);
        }
      } catch (error) {
        if (!this.running) {
          return;
        }

        this.logger.error(
          'Failed to poll wagering queue',
          error instanceof Error ? error.stack : String(error),
        );

        await this.delay(1_000);
      }
    }
  }

  /**
   * Processes one SQS delivery.
   *
   * The SQS message is acknowledged only after ProcessWagerMessage
   * completes successfully. Its database transaction has therefore
   * already committed before DeleteMessage is sent.
   */
  private async processMessage(message: {
    MessageId?: string;
    ReceiptHandle?: string;
    Body?: string;
  }): Promise<void> {
    if (
      !this.queueUrl ||
      !message.MessageId ||
      !message.ReceiptHandle ||
      !message.Body
    ) {
      this.logger.error('Received an invalid wagering SQS message');
      return;
    }

    try {
      const wager = JSON.parse(message.Body) as WagerTransactionRequested;

      const result = await this.processWagerMessage.execute({
        messageId: message.MessageId,
        wager,
      });

      await sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );

      this.logger.log(
        result.alreadyProcessed
          ? `Acknowledged redelivered message ${message.MessageId}`
          : `Processed and acknowledged message ${message.MessageId}`,
      );
    } catch (error) {
      /*
       * Do not acknowledge failures.
       *
       * SQS will make the message visible again after the visibility
       * timeout and eventually move repeated failures to the DLQ
       * according to the queue redrive policy.
       */
      this.logger.error(
        `Failed to process wagering message ${message.MessageId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
