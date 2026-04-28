import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';

/**
 * Wires up app-wide cross-cutting concerns:
 * - global exception filter (uniform error envelope)
 * - global response interceptor (uniform success envelope)
 *
 * The RolesGuard is provided here-but-not-bound; bind it as APP_GUARD
 * later if you want it global, or attach via @UseGuards(RolesGuard) per-route.
 */
@Global()
@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class CommonModule {}
