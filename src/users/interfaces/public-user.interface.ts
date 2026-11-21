import type { Role } from '../../common/enums/role.enum.ts';
import type { AuthProvider } from '../enums/auth-provider.enum.ts';

/** User representation safe to return over the API. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  provider: AuthProvider;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
