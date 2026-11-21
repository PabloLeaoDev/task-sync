import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { SignOptions } from 'jsonwebtoken';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.ts';
import { RedisService } from '../redis/redis.service.ts';
import type { User } from '../users/entities/user.entity.ts';
import type { OAuthProfile } from '../users/interfaces/oauth-profile.interface.ts';
import { UsersService } from '../users/users.service.ts';
import type { RegisterDto } from './dto/register.dto.ts';
import type { AuthResponse } from './interfaces/auth-response.interface.ts';
import type {
  JwtAccessPayload,
  JwtRefreshPayload,
} from './interfaces/jwt-payload.interface.ts';

const BLACKLIST_PREFIX = 'auth:blacklist';
const REFRESH_PREFIX = 'auth:refresh';

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: SignOptions['expiresIn'];
  private readonly refreshExpiresIn: SignOptions['expiresIn'];

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessExpiresIn = (config.get<string>('JWT_ACCESS_EXPIRES_IN') ??
      '15m') as SignOptions['expiresIn'];
    this.refreshExpiresIn = (config.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      '7d') as SignOptions['expiresIn'];
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const user = await this.usersService.createLocalUser(
      dto.email,
      dto.name,
      dto.password,
    );
    return this.issueTokens(user);
  }

  async validateLocalUser(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user?.passwordHash) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return null;
    }

    return this.toAuthenticatedUser(user);
  }

  async login(userId: string): Promise<AuthResponse> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return this.issueTokens(user);
  }

  /** Resolves (and links/creates) the account for a verified OAuth profile. */
  async resolveOAuthUser(profile: OAuthProfile): Promise<User> {
    return this.usersService.findOrCreateFromOAuth(profile);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(
        refreshToken,
        { secret: this.refreshSecret },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh' || !payload.sub || !payload.jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const sessionKey = this.refreshSessionKey(payload.sub, payload.jti);
    const activeSession = await this.redisService.take(sessionKey);
    if (!activeSession) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return this.issueTokens(user);
  }

  async logout(user: AuthenticatedUser, refreshToken?: string): Promise<void> {
    if (user.jti && user.tokenExp) {
      const ttl = user.tokenExp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redisService.set(
          `${BLACKLIST_PREFIX}:${user.jti}`,
          '1',
          ttl,
        );
      }
    }

    if (!refreshToken) {
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(
        refreshToken,
        { secret: this.refreshSecret },
      );

      if (
        payload.type === 'refresh' &&
        payload.sub === user.id &&
        payload.jti
      ) {
        await this.redisService.delete(
          this.refreshSessionKey(payload.sub, payload.jti),
        );
      }
    } catch {
      // An invalid refresh token is already unusable; logout still succeeds.
    }
  }

  private async issueTokens(user: User): Promise<AuthResponse> {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const accessPayload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: accessJti,
      type: 'access',
    };
    const refreshPayload: JwtRefreshPayload = {
      sub: user.id,
      jti: refreshJti,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.accessSecret,
        expiresIn: this.accessExpiresIn,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshExpiresIn,
      }),
    ]);

    const decodedRefresh =
      this.jwtService.decode<JwtRefreshPayload>(refreshToken);
    const decodedAccess = this.jwtService.decode<JwtAccessPayload>(accessToken);
    const now = Math.floor(Date.now() / 1000);
    const refreshTtl = Math.max(1, (decodedRefresh.exp ?? now + 1) - now);

    await this.redisService.set(
      this.refreshSessionKey(user.id, refreshJti),
      '1',
      refreshTtl,
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.max(0, (decodedAccess.exp ?? now) - now),
      user: this.usersService.toPublicUser(user),
    };
  }

  private toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  private refreshSessionKey(userId: string, tokenId: string): string {
    return `${REFRESH_PREFIX}:${userId}:${tokenId}`;
  }
}
