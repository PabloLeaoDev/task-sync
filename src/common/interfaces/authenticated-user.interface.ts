import type { Role } from '../enums/role.enum.ts';

/**
 * User information attached to the request after JWT authentication.
 * `jti` and `tokenExp` are present for access tokens so the token can be
 * revoked on logout.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  jti?: string;
  tokenExp?: number;
}
