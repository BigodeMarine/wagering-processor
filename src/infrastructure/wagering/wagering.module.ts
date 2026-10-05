import { Module } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionConsumer } from '../messaging/sqs/wager-transaction.consumer.js';
import { ProcessWagerTransaction } from '../../application/use-cases/process-wager-transaction.js';
import { ProcessWagerMessage } from '../../application/use-cases/process-wager-message.js';
import { CreateWallet } from '../../application/use-cases/create-wallet.js';
import { WalletController } from '../http/wallets/wallet.controller.js';
import { MikroOrmTransactionManager } from '../../persistence/mikro-orm-transaction-manager.js';
import { GetWallet } from '../../application/use-cases/get-wallet.js';
import { SystemClock } from '../time/system-clock.js';
import { UuidGenerator } from '../ids/uuid-generator.js';
import { WageringController } from '../http/wagering/wagering.controller.js';

import { CLOCK, ID_GENERATOR, TRANSACTION_MANAGER } from '../di/tokens.js';

@Module({
  controllers: [WalletController, WageringController],
  providers: [
    {
      provide: CLOCK,
      useClass: SystemClock,
    },
    {
      provide: ID_GENERATOR,
      useClass: UuidGenerator,
    },
    {
      provide: TRANSACTION_MANAGER,
      inject: [EntityManager],
      useFactory: (em: EntityManager) => new MikroOrmTransactionManager(em),
    },
    {
      provide: ProcessWagerTransaction,
      inject: [TRANSACTION_MANAGER, ID_GENERATOR, CLOCK],
      useFactory: (
        transactionManager: MikroOrmTransactionManager,
        idGenerator: UuidGenerator,
        clock: SystemClock,
      ) => new ProcessWagerTransaction(transactionManager, idGenerator, clock),
    },
    {
      provide: CreateWallet,
      inject: [TRANSACTION_MANAGER, ID_GENERATOR, CLOCK],
      useFactory: (
        transactionManager: MikroOrmTransactionManager,
        idGenerator: UuidGenerator,
        clock: SystemClock,
      ) => new CreateWallet(transactionManager, idGenerator, clock),
    },
    {
      provide: GetWallet,
      inject: [TRANSACTION_MANAGER],
      useFactory: (transactionManager: MikroOrmTransactionManager) =>
        new GetWallet(transactionManager),
    },
    {
      provide: ProcessWagerMessage,
      inject: [TRANSACTION_MANAGER, ProcessWagerTransaction, CLOCK],
      useFactory: (
        transactionManager: MikroOrmTransactionManager,
        processWagerTransaction: ProcessWagerTransaction,
        clock: SystemClock,
      ) =>
        new ProcessWagerMessage(
          transactionManager,
          processWagerTransaction,
          clock,
        ),
    },
    WagerTransactionConsumer,
  ],
  exports: [
    CLOCK,
    ID_GENERATOR,
    TRANSACTION_MANAGER,
    CreateWallet,
    GetWallet,
    ProcessWagerTransaction,
    ProcessWagerMessage,
  ],
})
export class WageringModule {}
