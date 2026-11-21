import type { AuthProvider } from '../enums/auth-provider.enum.ts';

/** Normalized profile data received from an OAuth provider. */
export interface OAuthProfile {
  provider: AuthProvider.GOOGLE | AuthProvider.GITHUB;
  providerId: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}
