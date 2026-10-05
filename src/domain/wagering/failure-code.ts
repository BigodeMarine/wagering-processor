/**
 * Códigos estáveis de falha utilizados em transações rejeitadas
 * ou em falhas permanentes auditáveis.
 */
export enum FailureCode {
  InsufficientBalance = 'INSUFFICIENT_BALANCE',

  ReversalWouldCauseNegativeBalance = 'REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE',

  ReferenceNotFound = 'REFERENCE_NOT_FOUND',

  ReferenceMismatch = 'REFERENCE_MISMATCH',

  InvalidReferenceKind = 'INVALID_REFERENCE_KIND',

  ReversalAmountMismatch = 'REVERSAL_AMOUNT_MISMATCH',

  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',

  PermanentInfrastructureFailure = 'PERMANENT_INFRASTRUCTURE_FAILURE',
}
