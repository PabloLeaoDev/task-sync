import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-github2';
import type { VerifyCallback } from 'passport-oauth2';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.ts';
import { AuthProvider } from '../../users/enums/auth-provider.enum.ts';
import { AuthService } from '../auth.service.ts';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: config.get<string>('GITHUB_CLIENT_ID') || 'not-configured',
      clientSecret:
        config.get<string>('GITHUB_CLIENT_SECRET') || 'not-configured',
      callbackURL:
        config.get<string>('GITHUB_CALLBACK_URL') ||
        'http://localhost:3000/auth/github/callback',
      scope: ['user:email'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    _done: VerifyCallback,
  ): Promise<AuthenticatedUser> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      throw new UnauthorizedException(
        'The GitHub account does not expose a verified email',
      );
    }

    const user = await this.authService.resolveOAuthUser({
      provider: AuthProvider.GITHUB,
      providerId: profile.id,
      email,
      name: profile.displayName || profile.username || email.split('@')[0],
      avatarUrl: profile.photos?.[0]?.value ?? null,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}
