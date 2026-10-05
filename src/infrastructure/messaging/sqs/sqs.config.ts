import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const ENDPOINT = process.env.SQS_ENDPOINT ?? 'http://localhost:4566';

export const WAGERING_DLQ_NAME = 'wager-transactions-dlq.fifo';
export const WAGERING_QUEUE_NAME = 'wager-transactions.fifo';
export const WAGERING_EVENTS_QUEUE_NAME = 'wager-events.fifo';

export const sqsClient = new SQSClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

/**
 * Ensures that the wagering input queue and its DLQ exist.
 *
 * The input queue uses a finite receive count. Messages that repeatedly
 * fail processing are eventually moved to the DLQ by SQS.
 */
export async function ensureWageringQueues(): Promise<void> {
  const dlq = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: WAGERING_DLQ_NAME,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'false',
      },
    }),
  );

  const eventsQueue = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: WAGERING_EVENTS_QUEUE_NAME,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'false',
      },
    }),
  );

  if (!eventsQueue.QueueUrl) {
    throw new Error('SQS did not return the wagering events queue URL');
  }

  if (!dlq.QueueUrl) {
    throw new Error('SQS did not return the wagering DLQ URL');
  }

  const dlqAttributes = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlq.QueueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );

  const dlqArn = dlqAttributes.Attributes?.QueueArn;

  if (!dlqArn) {
    throw new Error('SQS did not return the wagering DLQ ARN');
  }

  const queue = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: WAGERING_QUEUE_NAME,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'false',
      },
    }),
  );

  if (!queue.QueueUrl) {
    throw new Error('SQS did not return the wagering queue URL');
  }

  await sqsClient.send(
    new SetQueueAttributesCommand({
      QueueUrl: queue.QueueUrl,
      Attributes: {
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: 5,
        }),
      },
    }),
  );
}
/**
 * Returns the URL of the wagering input queue.
 *
 * Queue creation remains centralized in ensureWageringQueues(), while
 * consumers can resolve the queue URL without duplicating configuration.
 */
export async function getWageringQueueUrl(): Promise<string> {
  const result = await sqsClient.send(
    new GetQueueUrlCommand({
      QueueName: WAGERING_QUEUE_NAME,
    }),
  );

  if (!result.QueueUrl) {
    throw new Error('SQS did not return the wagering queue URL');
  }

  return result.QueueUrl;
}

/**
 * Returns the URL of the wagering dead-letter queue.
 */
export async function getWageringDlqUrl(): Promise<string> {
  const result = await sqsClient.send(
    new GetQueueUrlCommand({
      QueueName: WAGERING_DLQ_NAME,
    }),
  );

  if (!result.QueueUrl) {
    throw new Error('SQS did not return the wagering DLQ URL');
  }

  return result.QueueUrl;
}
/**
 * Returns the URL of the queue used to publish integration events
 * produced by the Transactional Outbox.
 */
export async function getWageringEventsQueueUrl(): Promise<string> {
  const result = await sqsClient.send(
    new GetQueueUrlCommand({
      QueueName: WAGERING_EVENTS_QUEUE_NAME,
    }),
  );

  if (!result.QueueUrl) {
    throw new Error('SQS did not return the wagering events queue URL');
  }

  return result.QueueUrl;
}
