import { describe, expect, it } from 'vitest';
import { InboxMessage } from './inbox-message.js';

describe('InboxMessage', () => {
  const receivedAt = new Date('2026-01-01T10:00:00.000Z');

  it('should receive a new unprocessed message', () => {
    const message = InboxMessage.receive({
      messageId: 'message-1',
      consumerName: 'wager-transaction-consumer',
      payloadHash: 'payload-hash-1',
      receivedAt,
    });

    expect(message.messageId).toBe('message-1');
    expect(message.consumerName).toBe(
      'wager-transaction-consumer',
    );
    expect(message.payloadHash).toBe('payload-hash-1');
    expect(message.receivedAt).toEqual(receivedAt);
    expect(message.processedAt).toBeUndefined();
    expect(message.isProcessed()).toBe(false);
  });

  it('should mark a message as processed', () => {
    const message = InboxMessage.receive({
      messageId: 'message-1',
      consumerName: 'wager-transaction-consumer',
      payloadHash: 'payload-hash-1',
      receivedAt,
    });

    const processedAt = new Date(
      '2026-01-01T10:05:00.000Z',
    );

    message.markProcessed(processedAt);

    expect(message.processedAt).toEqual(processedAt);
    expect(message.isProcessed()).toBe(true);
  });

  it('should preserve the first processedAt when marked more than once', () => {
    const message = InboxMessage.receive({
      messageId: 'message-1',
      consumerName: 'wager-transaction-consumer',
      payloadHash: 'payload-hash-1',
      receivedAt,
    });

    const firstProcessedAt = new Date(
      '2026-01-01T10:05:00.000Z',
    );

    const secondProcessedAt = new Date(
      '2026-01-01T10:10:00.000Z',
    );

    message.markProcessed(firstProcessedAt);
    message.markProcessed(secondProcessedAt);

    expect(message.processedAt).toEqual(firstProcessedAt);
  });

  it('should rehydrate an unprocessed message', () => {
    const message = InboxMessage.rehydrate({
      messageId: 'message-1',
      consumerName: 'wager-transaction-consumer',
      payloadHash: 'payload-hash-1',
      receivedAt,
    });

    expect(message.processedAt).toBeUndefined();
    expect(message.isProcessed()).toBe(false);
  });

  it('should rehydrate a processed message', () => {
    const processedAt = new Date(
      '2026-01-01T10:05:00.000Z',
    );

    const message = InboxMessage.rehydrate({
      messageId: 'message-1',
      consumerName: 'wager-transaction-consumer',
      payloadHash: 'payload-hash-1',
      receivedAt,
      processedAt,
    });

    expect(message.processedAt).toEqual(processedAt);
    expect(message.isProcessed()).toBe(true);
  });
});