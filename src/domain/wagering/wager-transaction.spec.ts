import { describe, expect, it } from 'vitest';
import { Money } from '../money/money.js';
import { FailureCode } from './failure-code.js';
import { WagerTransaction } from './wager-transaction.js';
import { WagerTransactionKind } from './wager-transaction-kind.js';
import { WagerTransactionStatus } from './wager-transaction-status.js';
import { LedgerDirection } from '../ledger/ledger-direction.js';

describe('WagerTransaction', () => {
  const createdAt = new Date('2026-01-01T10:00:00.000Z');

  function createTransaction(
    kind: WagerTransactionKind = WagerTransactionKind.Bet,
    referenceExternalTransactionId?: string,
  ): WagerTransaction {
    return WagerTransaction.create({
      id: 'transaction-1',
      providerId: 'provider-1',
      externalTransactionId: 'external-1',
      idempotencyKey: 'provider-1:external-1',
      payloadHash: 'hash-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind,
      money: Money.from({
        amount: '25.00',
        currency: 'BRL',
      }),
      referenceExternalTransactionId,
      createdAt,
    });
  }

  it('stores the resulting balance when processed', () => {
    const transaction = createTransaction();

    const resultingBalance = Money.from({
      amount: '75.00',
      currency: 'BRL',
    });

    transaction.markProcessed(
      undefined,
      resultingBalance,
      new Date('2026-10-05T12:00:00.000Z'),
    );

    expect(transaction.status).toBe(WagerTransactionStatus.Processed);

    expect(transaction.resultingBalance?.toJSON()).toEqual({
      amount: '75.00',
      currency: 'BRL',
    });
  });

  it('stores the observed balance when rejected', () => {
    const transaction = createTransaction();

    const resultingBalance = Money.from({
      amount: '20.00',
      currency: 'BRL',
    });

    transaction.reject(FailureCode.InsufficientBalance, resultingBalance);

    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);

    expect(transaction.resultingBalance?.toJSON()).toEqual({
      amount: '20.00',
      currency: 'BRL',
    });
  });

  it('does not require a resulting balance when permanently failed', () => {
    const transaction = createTransaction();

    transaction.fail(FailureCode.PermanentInfrastructureFailure);

    expect(transaction.status).toBe(WagerTransactionStatus.Failed);

    expect(transaction.resultingBalance).toBeUndefined();
  });

  describe('create', () => {
    it('should create a transaction in PENDING status', () => {
      const transaction = createTransaction();

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.failureCode).toBeUndefined();
      expect(transaction.referenceTransactionId).toBeUndefined();
      expect(transaction.processedAt).toBeUndefined();
      expect(transaction.isTerminal()).toBe(false);
    });

    it('should require referenceExternalTransactionId for REFUND', () => {
      expect(() => createTransaction(WagerTransactionKind.Refund)).toThrow(
        'REFUND requires referenceExternalTransactionId',
      );
    });

    it('should require referenceExternalTransactionId for ROLLBACK', () => {
      expect(() => createTransaction(WagerTransactionKind.Rollback)).toThrow(
        'ROLLBACK requires referenceExternalTransactionId',
      );
    });

    it('should create REFUND when reference is provided', () => {
      const transaction = createTransaction(
        WagerTransactionKind.Refund,
        'bet-123',
      );

      expect(transaction.referenceExternalTransactionId).toBe('bet-123');
      expect(transaction.requiresReference()).toBe(true);
    });

    it('should allow WIN without a reference', () => {
      const transaction = createTransaction(WagerTransactionKind.Win);

      expect(transaction.referenceExternalTransactionId).toBeUndefined();
      expect(transaction.requiresReference()).toBe(false);
    });

    it('should allow WIN with an optional reference', () => {
      const transaction = createTransaction(
        WagerTransactionKind.Win,
        'bet-123',
      );

      expect(transaction.referenceExternalTransactionId).toBe('bet-123');
      expect(transaction.requiresReference()).toBe(false);
    });
  });

  describe('domain queries', () => {
    it('should report which transactions affect balance', () => {
      expect(
        createTransaction(WagerTransactionKind.Opening).affectsBalance(),
      ).toBe(true);

      expect(createTransaction(WagerTransactionKind.Bet).affectsBalance()).toBe(
        true,
      );

      expect(createTransaction(WagerTransactionKind.Win).affectsBalance()).toBe(
        true,
      );

      expect(
        createTransaction(WagerTransactionKind.Loss).affectsBalance(),
      ).toBe(false);

      expect(
        createTransaction(
          WagerTransactionKind.Refund,
          'bet-123',
        ).affectsBalance(),
      ).toBe(true);

      expect(
        createTransaction(
          WagerTransactionKind.Rollback,
          'bet-123',
        ).affectsBalance(),
      ).toBe(true);
    });

    it('should require references only for REFUND and ROLLBACK', () => {
      expect(
        createTransaction(WagerTransactionKind.Bet).requiresReference(),
      ).toBe(false);

      expect(
        createTransaction(WagerTransactionKind.Win).requiresReference(),
      ).toBe(false);

      expect(
        createTransaction(WagerTransactionKind.Loss).requiresReference(),
      ).toBe(false);

      expect(
        createTransaction(
          WagerTransactionKind.Refund,
          'bet-123',
        ).requiresReference(),
      ).toBe(true);

      expect(
        createTransaction(
          WagerTransactionKind.Rollback,
          'bet-123',
        ).requiresReference(),
      ).toBe(true);
    });

    it('should match the original payload hash', () => {
      const transaction = createTransaction();

      expect(transaction.matchesPayload('hash-1')).toBe(true);
      expect(transaction.matchesPayload('different-hash')).toBe(false);
    });
  });

  describe('state transitions', () => {
    it('should mark a pending transaction as processed', () => {
      const transaction = createTransaction();
      const processedAt = new Date('2026-01-01T10:05:00.000Z');

      transaction.markProcessed(
        undefined,
        Money.from({
          amount: '75.00',
          currency: 'BRL',
        }),
        processedAt,
      );

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.processedAt).toEqual(processedAt);
      expect(transaction.referenceTransactionId).toBeUndefined();
      expect(transaction.failureCode).toBeUndefined();
      expect(transaction.isTerminal()).toBe(true);
    });

    it('should store the resolved internal reference when processed', () => {
      const transaction = createTransaction(
        WagerTransactionKind.Refund,
        'external-bet-1',
      );

      const processedAt = new Date('2026-01-01T10:05:00.000Z');

      transaction.markProcessed(
        'internal-bet-1',
        Money.from({
          amount: '75.00',
          currency: 'BRL',
        }),
        processedAt,
      );

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.referenceTransactionId).toBe('internal-bet-1');
      expect(transaction.processedAt).toEqual(processedAt);
    });

    it('should mark REFUND as PENDING_REFERENCE', () => {
      const transaction = createTransaction(
        WagerTransactionKind.Refund,
        'external-bet-1',
      );

      transaction.markPendingReference();

      expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
      expect(transaction.isTerminal()).toBe(false);
    });

    it('should keep PENDING_REFERENCE when the reference is still missing', () => {
      const transaction = createTransaction(
        WagerTransactionKind.Rollback,
        'external-bet-1',
      );

      transaction.markPendingReference();
      transaction.markPendingReference();

      expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
      expect(transaction.isTerminal()).toBe(false);
    });

    it('should not allow BET to become PENDING_REFERENCE', () => {
      const transaction = createTransaction(WagerTransactionKind.Bet);

      expect(() => transaction.markPendingReference()).toThrow(
        'Invalid transaction state transition',
      );

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    });

    it('should reject a transaction with a stable failure code', () => {
      const transaction = createTransaction();

      transaction.reject(
        FailureCode.InsufficientBalance,
        Money.from({
          amount: '20.00',
          currency: 'BRL',
        }),
      );

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.failureCode).toBe(FailureCode.InsufficientBalance);
      expect(transaction.isTerminal()).toBe(true);
    });

    it('should fail a transaction with a stable failure code', () => {
      const transaction = createTransaction();

      transaction.fail(FailureCode.PermanentInfrastructureFailure);

      expect(transaction.status).toBe(WagerTransactionStatus.Failed);
      expect(transaction.failureCode).toBe(
        FailureCode.PermanentInfrastructureFailure,
      );
      expect(transaction.isTerminal()).toBe(true);
    });
  });

  describe('rehydrate', () => {
    it('should restore a persisted terminal transaction', () => {
      const processedAt = new Date('2026-01-01T10:05:00.000Z');

      const transaction = WagerTransaction.rehydrate({
        id: 'transaction-10',
        providerId: 'provider-1',
        externalTransactionId: 'external-10',
        idempotencyKey: 'provider-1:external-10',
        payloadHash: 'hash-10',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: Money.from({
          amount: '25.00',
          currency: 'BRL',
        }),
        createdAt,
        status: WagerTransactionStatus.Rejected,
        failureCode: FailureCode.InsufficientBalance,
        processedAt,
      });

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.failureCode).toBe(FailureCode.InsufficientBalance);
      expect(transaction.processedAt).toEqual(processedAt);
      expect(transaction.isTerminal()).toBe(true);
    });
  });

  describe('ledgerDirectionFor', () => {
    it('should return CREDIT for OPENING', () => {
      const transaction = createTransaction(WagerTransactionKind.Opening);

      expect(transaction.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it('should return DEBIT for BET', () => {
      const transaction = createTransaction(WagerTransactionKind.Bet);

      expect(transaction.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });

    it('should return CREDIT for WIN', () => {
      const transaction = createTransaction(WagerTransactionKind.Win);

      expect(transaction.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it('should return undefined for LOSS', () => {
      const transaction = createTransaction(WagerTransactionKind.Loss);

      expect(transaction.ledgerDirectionFor()).toBeUndefined();
    });

    it('should return CREDIT for REFUND', () => {
      const transaction = createTransaction(
        WagerTransactionKind.Refund,
        'external-bet-1',
      );

      expect(transaction.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it('should return CREDIT when rolling back a BET', () => {
      const reference = createTransaction(WagerTransactionKind.Bet);

      const rollback = createTransaction(
        WagerTransactionKind.Rollback,
        'external-bet-1',
      );

      expect(rollback.ledgerDirectionFor(reference)).toBe(
        LedgerDirection.Credit,
      );
    });

    it('should return DEBIT when rolling back a WIN', () => {
      const reference = createTransaction(WagerTransactionKind.Win);

      const rollback = createTransaction(
        WagerTransactionKind.Rollback,
        'external-win-1',
      );

      expect(rollback.ledgerDirectionFor(reference)).toBe(
        LedgerDirection.Debit,
      );
    });

    it('should return DEBIT when rolling back a REFUND', () => {
      const reference = createTransaction(
        WagerTransactionKind.Refund,
        'external-bet-1',
      );

      const rollback = createTransaction(
        WagerTransactionKind.Rollback,
        'external-refund-1',
      );

      expect(rollback.ledgerDirectionFor(reference)).toBe(
        LedgerDirection.Debit,
      );
    });

    it('should reject ROLLBACK without a resolved reference', () => {
      const rollback = createTransaction(
        WagerTransactionKind.Rollback,
        'external-bet-1',
      );

      expect(() => rollback.ledgerDirectionFor()).toThrow(
        'ROLLBACK requires resolved reference transaction',
      );
    });

    it.each([
      WagerTransactionKind.Opening,
      WagerTransactionKind.Loss,
      WagerTransactionKind.Rollback,
    ])('should reject ROLLBACK referencing %s', (referenceKind) => {
      const referenceExternalTransactionId =
        referenceKind === WagerTransactionKind.Rollback
          ? 'external-reference-1'
          : undefined;

      const reference = createTransaction(
        referenceKind,
        referenceExternalTransactionId,
      );

      const rollback = createTransaction(
        WagerTransactionKind.Rollback,
        'external-reference-1',
      );

      expect(() => rollback.ledgerDirectionFor(reference)).toThrow(
        `ROLLBACK cannot reference ${referenceKind}`,
      );
    });
  });

  describe('validateReference', () => {
    it('should accept a processed BET as reference for REFUND', () => {
      const reference = createTransaction(WagerTransactionKind.Bet);

      reference.markProcessed(
        undefined,
        Money.from({
          amount: '75.00',
          currency: 'BRL',
        }),
        new Date('2026-01-01T10:05:00.000Z'),
      );

      const refund = createTransaction(
        WagerTransactionKind.Refund,
        reference.externalTransactionId,
      );

      expect(refund.validateReference(reference)).toBeUndefined();
    });

    it.each([
      WagerTransactionKind.Win,
      WagerTransactionKind.Refund,
      WagerTransactionKind.Loss,
      WagerTransactionKind.Rollback,
      WagerTransactionKind.Opening,
    ])('should reject %s as reference for REFUND', (referenceKind) => {
      const referenceExternalTransactionId =
        referenceKind === WagerTransactionKind.Refund ||
        referenceKind === WagerTransactionKind.Rollback
          ? 'external-original-bet'
          : undefined;

      const reference = createTransaction(
        referenceKind,
        referenceExternalTransactionId,
      );

      reference.markProcessed(
        undefined,
        Money.from({
          amount: '75.00',
          currency: 'BRL',
        }),
        new Date('2026-01-01T10:05:00.000Z'),
      );

      const refund = createTransaction(
        WagerTransactionKind.Refund,
        reference.externalTransactionId,
      );

      expect(refund.validateReference(reference)).toBe(
        FailureCode.InvalidReferenceKind,
      );
    });

    it.each([
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Refund,
    ])(
      'should accept processed %s as reference for ROLLBACK',
      (referenceKind) => {
        const referenceExternalTransactionId =
          referenceKind === WagerTransactionKind.Refund
            ? 'external-original-bet'
            : undefined;

        const reference = createTransaction(
          referenceKind,
          referenceExternalTransactionId,
        );

        reference.markProcessed(
          undefined,
          Money.from({
            amount: '75.00',
            currency: 'BRL',
          }),
          new Date('2026-01-01T10:05:00.000Z'),
        );

        const rollback = createTransaction(
          WagerTransactionKind.Rollback,
          reference.externalTransactionId,
        );

        expect(rollback.validateReference(reference)).toBeUndefined();
      },
    );

    it.each([
      WagerTransactionKind.Opening,
      WagerTransactionKind.Loss,
      WagerTransactionKind.Rollback,
    ])('should reject %s as reference for ROLLBACK', (referenceKind) => {
      const referenceExternalTransactionId =
        referenceKind === WagerTransactionKind.Rollback
          ? 'external-original-bet'
          : undefined;

      const reference = createTransaction(
        referenceKind,
        referenceExternalTransactionId,
      );

      reference.markProcessed(
        undefined,
        Money.from({
          amount: '75.00',
          currency: 'BRL',
        }),
        new Date('2026-01-01T10:05:00.000Z'),
      );

      const rollback = createTransaction(
        WagerTransactionKind.Rollback,
        reference.externalTransactionId,
      );

      expect(rollback.validateReference(reference)).toBe(
        FailureCode.InvalidReferenceKind,
      );
    });

    it('should reject a reference that is not PROCESSED', () => {
      const reference = createTransaction(WagerTransactionKind.Bet);

      const refund = createTransaction(
        WagerTransactionKind.Refund,
        reference.externalTransactionId,
      );

      expect(refund.validateReference(reference)).toBe(
        FailureCode.ReferenceMismatch,
      );
    });

    it.each([
      ['providerId', 'provider-2'],
      ['playerId', 'player-2'],
      ['walletId', 'wallet-2'],
      ['roundId', 'round-2'],
    ] as const)(
      'should reject reference with different %s',
      (field, differentValue) => {
        const reference = createTransaction(WagerTransactionKind.Bet);

        reference.markProcessed(
          undefined,
          Money.from({
            amount: '75.00',
            currency: 'BRL',
          }),
          new Date('2026-01-01T10:05:00.000Z'),
        );

        const refund = WagerTransaction.create({
          id: 'refund-1',
          providerId: 'provider-1',
          externalTransactionId: 'refund-external-1',
          idempotencyKey: 'provider-1:refund-external-1',
          payloadHash: 'refund-hash',
          walletId: 'wallet-1',
          playerId: 'player-1',
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Refund,
          money: Money.from({
            amount: '25.00',
            currency: 'BRL',
          }),
          referenceExternalTransactionId: reference.externalTransactionId,
          createdAt,
          [field]: differentValue,
        });

        expect(refund.validateReference(reference)).toBe(
          FailureCode.ReferenceMismatch,
        );
      },
    );

    it.each([
      ['providerId', 'provider-2'],
      ['playerId', 'player-2'],
      ['walletId', 'wallet-2'],
      ['roundId', 'round-2'],
    ] as const)(
      'should reject reference with different %s',
      (field, differentValue) => {
        const reference = createTransaction(WagerTransactionKind.Bet);
        reference.markProcessed(
          undefined,
          Money.from({
            amount: '75.00',
            currency: 'BRL',
          }),
          new Date('2026-01-01T10:05:00.000Z'),
        );

        const refund = WagerTransaction.create({
          id: 'refund-1',
          providerId: 'provider-1',
          externalTransactionId: 'refund-external-1',
          idempotencyKey: 'provider-1:refund-external-1',
          payloadHash: 'refund-hash',
          walletId: 'wallet-1',
          playerId: 'player-1',
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Refund,
          money: Money.from({
            amount: '25.00',
            currency: 'BRL',
          }),
          referenceExternalTransactionId: reference.externalTransactionId,
          createdAt,
          [field]: differentValue,
        });

        expect(refund.validateReference(reference)).toBe(
          FailureCode.ReferenceMismatch,
        );
      },
    );
  });
});
