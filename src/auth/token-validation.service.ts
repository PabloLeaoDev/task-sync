import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.ts';
import { RedisService } from '../redis/redis.service.ts';
import { UsersService } from '../users/users.service.ts';
import type { JwtAccessPayload } from './interfaces/jwt-payload.interface.ts';

const BLACKLIST_PREFIX = 'auth:blacklist';

/**
 * Validates access tokens for both HTTP (JwtStrategy) and WebSocket
 * handshakes, enforcing the Redis blacklist and the current user role.
 */
@Injectable()
export class TokenValidationService {
  private readonly accessSecret: string;

  constructor(
    config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
  ) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  async validateAccessToken(token: string): Promise<AuthenticatedUser> {
    let payload: JwtAccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
        secret: this.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return this.validatePayload(payload);
  }

  async validatePayload(
    payload: JwtAccessPayload,
  ): Promise<AuthenticatedUser> {
    if (payload.type !== 'access' || !payload.jti) {
      throw new UnauthorizedException('Invalid access token');
    }

    const isBlacklisted = await this.redisService.exists(
      `${BLACKLIST_PREFIX}:${payload.jti}`,
    );
    if (isBlacklisted) {
      throw new UnauthorizedException('Access token has been revoked');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      jti: payload.jti,
      tokenExp: payload.exp,
    };
  }
}
