import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { AppService, type ReadinessResult } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Liveness only verifies that the application process
   * is running and able to serve HTTP requests.
   */
  @Get('live')
  getLiveness(): { status: 'ok' } {
    return {
      status: 'ok',
    };
  }

  /**
   * Readiness verifies the external dependencies required
   * for this instance to process wagering transactions.
   */
  @Get('ready')
  async getReadiness(): Promise<ReadinessResult> {
    try {
      return await this.appService.checkReadiness();
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
      });
    }
  }
}
