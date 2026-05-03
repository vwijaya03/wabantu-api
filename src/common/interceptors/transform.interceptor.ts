import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { SKIP_RESPONSE_TRANSFORM_KEY } from '../decorators/skip-response-transform.decorator';

export interface ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * Wraps successful controller responses in a stable envelope:
 *   { success: true, data: <controller-return> }
 *
 * Errors are still emitted as { success: false, ... } via AllExceptionsFilter.
 * Skipped when controller returns `undefined` (e.g. 204 No Content) or
 * when it explicitly returns `{ raw: true, data: ... }`.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    ctx: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_TRANSFORM_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (skip) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => {
        if (data === undefined || data === null) return data;
        if (
          typeof data === 'object' &&
          'raw' in (data as object) &&
          (data as unknown as { raw?: boolean }).raw === true
        ) {
          return (data as unknown as { data: T }).data;
        }
        return { success: true, data };
      }),
    );
  }
}
