import type { Clock } from '../../application/ports/clock.js';

/**
 * Relógio de produção baseado no relógio do sistema.
 *
 * A abstração Clock permite substituir o tempo real por um relógio
 * determinístico nos testes.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}