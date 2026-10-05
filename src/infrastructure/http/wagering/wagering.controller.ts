import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';

import { ProcessWagerTransaction } from '../../../application/use-cases/process-wager-transaction.js';
import { IdempotencyConflictError } from '../../../application/errors/idempotency-conflict.error.js';

import { ProcessWagerTransactionDto } from './dto/process-wager-transaction.dto.js';

@Controller('wagering')
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransaction,
  ) {}

  @Post('transactions')
  async processTransaction(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ProcessWagerTransactionDto,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    try {
      return await this.processWagerTransaction.execute({
        idempotencyKey: idempotencyKey.trim(),
        providerId: body.providerId,
        externalTransactionId: body.externalTransactionId,
        playerId: body.playerId,
        walletId: body.walletId,
        roundId: body.roundId,
        gameId: body.gameId,
        kind: body.kind,
        money: body.money,
        referenceExternalTransactionId: body.referenceExternalTransactionId,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }
}
