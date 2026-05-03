import { SetMetadata } from '@nestjs/common';

/** When set, `TransformInterceptor` passes the handler result through unchanged (e.g. SSE streams). */
export const SKIP_RESPONSE_TRANSFORM_KEY = 'skipResponseTransform';

export const SkipResponseTransform = () =>
  SetMetadata(SKIP_RESPONSE_TRANSFORM_KEY, true);
