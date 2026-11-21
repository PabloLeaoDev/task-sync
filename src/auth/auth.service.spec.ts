import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { Role } from '../common/enums/role.enum.ts';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.ts';
import type { RedisService } from '../redis/redis.service.ts';
import { User } from '../users/entities/user.entity.ts';
import { AuthProvider } from '../users/enums/auth-provider.enum.ts';
import type { UsersService } from '../users/users.service.ts';
import { AuthService } from './auth.service.ts';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmailWithPassword: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findOrCreateFromOAuth: ReturnType<typeof vi.fn>;
    createLocalUser: ReturnType<typeof vi.fn>;
    toPublicUser: ReturnType<typeof vi.fn>;
  };
  let jwtService: {
    signAsync: ReturnType<typeof vi.fn>;
    verifyAsync: ReturnType<typeof vi.fn>;
    decode: ReturnType<typeof vi.fn>;
  };
  let redisService: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    take: ReturnType<typeof vi.fn>;
  };

  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@tasksync.dev',
    name: 'User',
    passwordHash: '',
    provider: AuthProvider.LOCAL,
    googleId: null,
    githubId: null,
    avatarUrl: null,
    role: Role.MEMBER,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const config = {
    getOrThrow: (key: string) => `secret-${key}`,
    get: (key: string, fallback?: unknown) =>
      key.startsWith('JWT_') ? fallback : fallback,
  } as unknown as ConfigService;

  beforeEach(() => {
    usersService = {
      findByEmailWithPassword: vi.fn(),
      findById: vi.fn().mockResolvedValue(user),
      findOrCreateFromOAuth: vi.fn(),
      createLocalUser: vi.fn().mockResolvedValue(user),
      toPublicUser: vi.fn((value: User) => ({ id: value.id })),
    };

    jwtService = {
      signAsync: vi.fn((payload: { type: string }) =>
        Promise.resolve(
          payload.type === 'access' ? 'access-token' : 'refresh-token',
        ),
      ),
      verifyAsync: vi.fn(),
      decode: vi.fn((token: string) => ({
        exp:
          Math.floor(Date.now() / 1000) +
          (token === 'access-token' ? 900 : 604_800),
      })),
    };

    redisService = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      take: vi.fn(),
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      redisService as unknown as RedisService,
      config,
    );
  });

  it('returns the user for valid local credentials', async () => {
    user.passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByEmailWithPassword.mockResolvedValue(user);

    const result = await service.validateLocalUser(
      'user@tasksync.dev',
      'password123',
    );

    expect(result).toMatchObject({ id: user.id, role: Role.MEMBER });
  });

  it('returns null for an invalid local password', async () => {
    user.passwordHash = await bcrypt.hash('password123', 4);
    usersService.findByEmailWithPassword.mockResolvedValue(user);

    await expect(
      service.validateLocalUser('user@tasksync.dev', 'wrong-password'),
    ).resolves.toBeNull();
  });

  it('issues and stores a refresh session on login', async () => {
    const result = await service.login(user.id);

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.expiresIn).toBe(900);
    expect(redisService.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:refresh:.+:/),
      '1',
      expect.any(Number),
    );
    const [, , ttl] = redisService.set.mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(ttl).toBeGreaterThan(0);
  });

  it('rotates a refresh token exactly once', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      jti: 'refresh-jti',
      type: 'refresh',
    });
    redisService.take.mockResolvedValue('1');

    const result = await service.refresh('refresh-token');

    expect(redisService.take).toHaveBeenCalledWith(
      `auth:refresh:${user.id}:refresh-jti`,
    );
    expect(result.accessToken).toBe('access-token');
  });

  it('rejects a refresh token whose session was revoked', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      jti: 'refresh-jti',
      type: 'refresh',
    });
    redisService.take.mockResolvedValue(null);

    await expect(service.refresh('refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('blacklists the access token on logout', async () => {
    const authenticated: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      jti: 'access-jti',
      tokenExp: Math.floor(Date.now() / 1000) + 600,
    };

    await service.logout(authenticated);

    expect(redisService.set).toHaveBeenCalledWith(
      'auth:blacklist:access-jti',
      '1',
      expect.any(Number),
    );
    const [, , ttl] = redisService.set.mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(ttl).toBeGreaterThan(0);
  });
});
