/**
 * Contexto necessário para criar um evento de integração.
 * Mantém informações de rastreabilidade separadas dos dados específicos
 * de cada evento.
 */
export interface EventContext {
  eventId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
}
