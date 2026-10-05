import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';

import {
  GetWallet,
  type GetWalletOutput,
} from '../../../application/use-cases/get-wallet.js';

import {
  CreateWallet,
  type CreateWalletOutput,
} from '../../../application/use-cases/create-wallet.js';

import { CreateWalletDto } from './dto/create-wallet.dto.js';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet: CreateWallet,
    private readonly getWallet: GetWallet,
  ) {}

  @Post()
  async create(@Body() body: CreateWalletDto): Promise<CreateWalletOutput> {
    try {
      return await this.createWallet.execute({
        playerId: body.playerId,
        currency: body.currency,
        initialBalance: body.initialBalance,
      });
    } catch (error) {
      /*
       * O banco é a garantia final de unicidade para
       * playerId + currency, inclusive sob concorrência.
       */
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException(
          'Wallet already exists for player and currency',
        );
      }

      throw error;
    }
  }
  @Get(':id')
  async findById(@Param('id') walletId: string): Promise<GetWalletOutput> {
    const wallet = await this.getWallet.execute(walletId);

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }
}
