export class IdempotencyConflictError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(
      `Idempotency key "${idempotencyKey}" was already used with a different payload`,
    );

    this.name = 'IdempotencyConflictError';
  }
}