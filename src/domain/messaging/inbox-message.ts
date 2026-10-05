export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState extends ReceiveInboxProps {
  processedAt?: Date;
}

/**
 * Representa uma mensagem recebida por um consumidor.
 * A Inbox fornece a base de domínio para deduplicação persistente
 * de mensagens entregues pelo broker.
 */
export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  /**
   * Registra uma nova mensagem recebida.
   * Uma nova mensagem ainda não foi processada.
   */
  static receive(props: ReceiveInboxProps): InboxMessage {
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt,
    );
  }

  /**
   * Reconstrói uma InboxMessage previamente persistida.
   */
  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  /**
   * Indica se a mensagem já foi processada.
   */
  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  /**
   * Marca a mensagem como processada.
   * A operação é idempotente: chamadas posteriores não alteram
   * o instante original de processamento.
   */
  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      return;
    }

    this._processedAt = at;
  }
}