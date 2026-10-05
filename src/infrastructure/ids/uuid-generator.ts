import { randomUUID } from 'node:crypto';

import type { IdGenerator } from '../../application/ports/id-generator.js';

/**
 * Gerador de identificadores UUID utilizado pela infraestrutura.
 *
 * O domínio e os use cases dependem apenas da abstração IdGenerator.
 */
export class UuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}