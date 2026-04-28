import { SetMetadata } from '@nestjs/common';
import type { TenantRole } from '../types/request.types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: TenantRole[]) => SetMetadata(ROLES_KEY, roles);
