import type { Request } from 'express';

export type TenantRole = 'owner' | 'staff';

export interface AuthUser {
  /** Stable user id (UUID) within the tenant schema. */
  userId: string;
  /** Owning tenant id (system table primary key). */
  tenantId: string;
  /** Schema name in the jb_tenant database for this tenant. */
  tenantSchema: string;
  /** Email used to log in. */
  email: string;
  /** Role within the current tenant. */
  role: TenantRole;
  /** Redis session id used to revoke this session. */
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
