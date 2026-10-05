import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

import {
  getWageringQueueUrl,
  sqsClient,
} from './infrastructure/messaging/sqs/sqs.config.js';

export interface ReadinessResult {
  status: 'ready';
  checks: {
    database: 'up';
    sqs: 'up';
  };
}

@Injectable()
export class AppService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Verifies whether the dependencies required to process
   * wagering transactions are reachable.
   */
  async checkReadiness(): Promise<ReadinessResult> {
    await this.checkDatabase();
    await this.checkSqs();

    return {
      status: 'ready',
      checks: {
        database: 'up',
        sqs: 'up',
      },
    };
  }

  private async checkDatabase(): Promise<void> {
    await this.em.getConnection().execute('SELECT 1');
  }

  private async checkSqs(): Promise<void> {
    const queueUrl = await getWageringQueueUrl();

    await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
  }
}
