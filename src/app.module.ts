import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WageringModule } from './infrastructure/wagering/wagering.module.js';
import mikroOrmConfig from './mikro-orm.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    MikroOrmModule.forRoot(mikroOrmConfig),
    WageringModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
