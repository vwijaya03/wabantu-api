import { SetMetadata } from '@nestjs/common';

/** Routes flagged with @Public() bypass the global JwtAuthGuard. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
