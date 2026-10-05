import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  const appServiceMock = {
    checkReadiness: async () => ({
      status: 'ready' as const,
      checks: {
        database: 'up' as const,
        sqs: 'up' as const,
      },
    }),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: appServiceMock,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health checks', () => {
    it('returns ok when the application is alive', () => {
      expect(appController.getLiveness()).toEqual({
        status: 'ok',
      });
    });

    it('returns ready when required dependencies are available', async () => {
      await expect(appController.getReadiness()).resolves.toEqual({
        status: 'ready',
        checks: {
          database: 'up',
          sqs: 'up',
        },
      });
    });
  });
});
