import { describe, expect, it } from 'vitest';

import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import {
  CanonicalPayloadHasher,
  type WagerTransactionPayload,
} from './canonical-payload-hasher.js';

describe('CanonicalPayloadHasher', () => {
  const payload: WagerTransactionPayload = {
    providerId: 'provider-a',
    externalTransactionId: 'bet-001',
    playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
    walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
    roundId: 'round-001',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: {
      amount: '25.00',
      currency: 'BRL',
    },
  };

  it('produces the same hash for the same business payload', () => {
    const firstHash = CanonicalPayloadHasher.hash(payload);
    const secondHash = CanonicalPayloadHasher.hash({ ...payload });

    expect(firstHash).toBe(secondHash);
  });

  it('produces a SHA-256 hexadecimal hash', () => {
    const hash = CanonicalPayloadHasher.hash(payload);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces a different hash when a business field changes', () => {
    const originalHash = CanonicalPayloadHasher.hash(payload);

    const changedHash = CanonicalPayloadHasher.hash({
      ...payload,
      money: {
        amount: '250.00',
        currency: 'BRL',
      },
    });

    expect(changedHash).not.toBe(originalHash);
  });

  it('treats an absent reference as null in the canonical payload', () => {
    const withoutReference = CanonicalPayloadHasher.hash(payload);

    const withUndefinedReference = CanonicalPayloadHasher.hash({
      ...payload,
      referenceExternalTransactionId: undefined,
    });

    expect(withoutReference).toBe(withUndefinedReference);
  });

  it('includes the reference transaction in the hash when present', () => {
    const withoutReference = CanonicalPayloadHasher.hash(payload);

    const withReference = CanonicalPayloadHasher.hash({
      ...payload,
      referenceExternalTransactionId: 'bet-original-001',
    });

    expect(withReference).not.toBe(withoutReference);
  });
});