import { Money } from '../money/money.js';
import { FailureCode } from './failure-code.js';
import { WagerTransactionKind } from './wager-transaction-kind.js';
import { WagerTransactionStatus } from './wager-transaction-status.js';
import { InvalidTransactionStateError } from './invalid-transaction-state.error.js';
import { LedgerDirection } from '../ledger/ledger-direction.js';

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  resultingBalance?: Money;
}

/**
 * Representa uma operação financeira recebida de um provedor.
 * A entidade mantém o estado da operação e controla suas
 * transições de domínio.
 */
export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _resultingBalance?: Money,
  ) {}

  /**
   * Cria uma nova transação.
   * Toda nova transação nasce em PENDING.
   */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (
      WagerTransaction.requiresReferenceFor(props.kind) &&
      !props.referenceExternalTransactionId
    ) {
      throw new Error(`${props.kind} requires referenceExternalTransactionId`);
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
    );
  }

  /**
   * Reconstrói uma transação previamente persistida.
   * Não reaplica as regras de criação nem executa
   * transições de estado.
   */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.resultingBalance,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get resultingBalance(): Money | undefined {
    return this._resultingBalance;
  }

  /**
   * Indica se a transação já alcançou um estado terminal.
   */
  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  /**
   * Indica se o tipo de operação pode alterar o saldo.
   * LOSS apenas registra o resultado da rodada.
   */
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  /**
   * REFUND e ROLLBACK obrigatoriamente referenciam
   * outra transação.
   */
  requiresReference(): boolean {
    return WagerTransaction.requiresReferenceFor(this.kind);
  }

  /**
   * Verifica se um payload corresponde ao payload original
   * associado à chave de idempotência.
   */
  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  private static requiresReferenceFor(kind: WagerTransactionKind): boolean {
    return (
      kind === WagerTransactionKind.Refund ||
      kind === WagerTransactionKind.Rollback
    );
  }

  /**
   * Marca a transação como processada.
   * A referência interna é armazenada quando a operação
   * foi resolvida contra outra WagerTransaction.
   */
  markProcessed(
    referenceTransactionId: string | undefined,
    resultingBalance: Money,
    at: Date,
  ): void {
    this.assertNotTerminal(WagerTransactionStatus.Processed);

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._failureCode = undefined;
    this._resultingBalance = resultingBalance;
    this._processedAt = at;
  }

  /**
   * Indica que a transação ainda não pode ser processada
   * porque sua referência não foi encontrada.
   */
  markPendingReference(): void {
    this.assertNotTerminal(WagerTransactionStatus.PendingReference);

    if (!this.requiresReference()) {
      throw new InvalidTransactionStateError(
        this._status,
        WagerTransactionStatus.PendingReference,
      );
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  /**
   * Rejeita a transação por uma regra de negócio.
   */
  reject(code: FailureCode, resultingBalance: Money): void {
    this.assertNotTerminal(WagerTransactionStatus.Rejected);

    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._resultingBalance = resultingBalance;
  }

  /**
   * Marca uma falha permanente de infraestrutura.
   */
  fail(code: FailureCode): void {
    this.assertNotTerminal(WagerTransactionStatus.Failed);

    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  private assertNotTerminal(targetStatus: WagerTransactionStatus): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status, targetStatus);
    }
  }

  /**
   * Retorna a direção do lançamento financeiro produzido
   * pela transação.
   *
   * LOSS não altera saldo e, portanto, não gera lançamento.
   * ROLLBACK utiliza a direção inversa da transação referenciada.
   */
  ledgerDirectionFor(
    reference?: WagerTransaction,
  ): LedgerDirection | undefined {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Win:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Loss:
        return undefined;

      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Rollback:
        return this.rollbackDirectionFor(reference);
    }
  }

  /**
   * Determina a direção financeira de um ROLLBACK
   * invertendo o efeito da transação referenciada.
   */
  private rollbackDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (!reference) {
      throw new Error('ROLLBACK requires resolved reference transaction');
    }

    switch (reference.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Debit;

      default:
        throw new Error(`ROLLBACK cannot reference ${reference.kind}`);
    }
  }

  /**
   * Valida se uma transação pode ser utilizada como referência
   * para esta operação.
   *
   * Retorna undefined quando a referência é válida ou um FailureCode
   * quando existe uma incompatibilidade de negócio.
   */
  validateReference(reference: WagerTransaction): FailureCode | undefined {
    if (!this.isAllowedReferenceKind(reference.kind)) {
      return FailureCode.InvalidReferenceKind;
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return FailureCode.ReferenceMismatch;
    }

    if (
      this.providerId !== reference.providerId ||
      this.playerId !== reference.playerId ||
      this.walletId !== reference.walletId ||
      this.money.currency !== reference.money.currency ||
      this.roundId !== reference.roundId
    ) {
      return FailureCode.ReferenceMismatch;
    }

    if (!this.money.equals(reference.money)) {
      return FailureCode.ReversalAmountMismatch;
    }

    return undefined;
  }

  /**
   * Verifica se o tipo da transação referenciada é permitido
   * para a operação atual.
   */
  private isAllowedReferenceKind(referenceKind: WagerTransactionKind): boolean {
    if (this.kind === WagerTransactionKind.Refund) {
      return referenceKind === WagerTransactionKind.Bet;
    }

    if (this.kind === WagerTransactionKind.Rollback) {
      return (
        referenceKind === WagerTransactionKind.Bet ||
        referenceKind === WagerTransactionKind.Win ||
        referenceKind === WagerTransactionKind.Refund
      );
    }

    return false;
  }
}
