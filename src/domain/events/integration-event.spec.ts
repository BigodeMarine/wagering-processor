import { describe, expect, it } from 'vitest';
import {
  IntegrationEvent,
  type IntegrationEventProps,
} from './integration-event.js';

interface TestEventData {
  transactionId: string;
  status: string;
}

class TestIntegrationEvent extends IntegrationEvent<TestEventData> {
  readonly eventType = 'TestIntegrationEvent';
  readonly version = 1;

  constructor(props: IntegrationEventProps<TestEventData>) {
    super(props);
  }
}

describe('IntegrationEvent', () => {
  const occurredAt = new Date('2026-07-29T15:00:00.000Z');

  it('should create an integration event with its envelope', () => {
    const event = new TestIntegrationEvent({
      eventId: 'event-123',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      occurredAt,
      data: {
        transactionId: 'transaction-123',
        status: 'PROCESSED',
      },
    });

    expect(event.eventId).toBe('event-123');
    expect(event.eventType).toBe('TestIntegrationEvent');
    expect(event.version).toBe(1);
    expect(event.aggregateId).toBe('transaction-123');
    expect(event.correlationId).toBe('correlation-123');
    expect(event.causationId).toBeUndefined();
    expect(event.occurredAt).toEqual(occurredAt);
    expect(event.data).toEqual({
      transactionId: 'transaction-123',
      status: 'PROCESSED',
    });
  });

  it('should preserve causationId when provided', () => {
    const event = new TestIntegrationEvent({
      eventId: 'event-123',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt,
      data: {
        transactionId: 'transaction-123',
        status: 'PROCESSED',
      },
    });

    expect(event.causationId).toBe('message-123');
  });

  it('should serialize the event using a stable envelope', () => {
    const event = new TestIntegrationEvent({
      eventId: 'event-123',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt,
      data: {
        transactionId: 'transaction-123',
        status: 'PROCESSED',
      },
    });

    expect(event.toJSON()).toEqual({
      eventId: 'event-123',
      eventType: 'TestIntegrationEvent',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      causationId: 'message-123',
      occurredAt: '2026-07-29T15:00:00.000Z',
      version: 1,
      data: {
        transactionId: 'transaction-123',
        status: 'PROCESSED',
      },
    });
  });

  it('should omit causationId from serialization when absent', () => {
    const event = new TestIntegrationEvent({
      eventId: 'event-123',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      occurredAt,
      data: {
        transactionId: 'transaction-123',
        status: 'PROCESSED',
      },
    });

    expect(event.toJSON()).toEqual({
      eventId: 'event-123',
      eventType: 'TestIntegrationEvent',
      aggregateId: 'transaction-123',
      correlationId: 'correlation-123',
      occurredAt: '2026-07-29T15:00:00.000Z',
      version: 1,
      data: {
        transactionId: 'transaction-123',
        status: 'PROCESSED',
      },
    });
  });
});
