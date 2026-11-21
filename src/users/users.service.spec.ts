import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import type { Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum.ts';
import { User } from './entities/user.entity.ts';
import { AuthProvider } from './enums/auth-provider.enum.ts';
import { UsersService } from './users.service.ts';

describe('UsersService', () => {
  let service: UsersService;
  let repository: {
    findOne: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  const config = {
    get: (key: string, fallback?: unknown) =>
      key === 'BCRYPT_SALT_ROUNDS' ? 4 : fallback,
  } as unknown as ConfigService;

  const makeUser = (overrides: Partial<User> = {}): User =>
    ({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@tasksync.dev',
      name: 'User',
      passwordHash: null,
      provider: AuthProvider.LOCAL,
      googleId: null,
      githubId: null,
      avatarUrl: null,
      role: Role.MEMBER,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as User;

  beforeEach(() => {
    repository = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(),
      create: vi.fn((data: Partial<User>) => makeUser(data)),
      save: vi.fn((user: User) => Promise.resolve(user)),
      delete: vi.fn(),
      createQueryBuilder: vi.fn(),
    };

    service = new UsersService(
      repository as unknown as Repository<User>,
      config,
    );
  });

  it('hashes the password when creating a local user', async () => {
    const user = await service.createLocalUser(
      'New@TaskSync.dev',
      'New User',
      'password123',
    );

    expect(user.email).toBe('new@tasksync.dev');
    expect(user.passwordHash).not.toBe('password123');
    await expect(
      bcrypt.compare('password123', user.passwordHash ?? ''),
    ).resolves.toBe(true);
    expect(user.provider).toBe(AuthProvider.LOCAL);
    expect(user.role).toBe(Role.MEMBER);
  });

  it('rejects an email that is already registered', async () => {
    repository.findOne.mockResolvedValue(makeUser());

    await expect(
      service.createLocalUser('user@tasksync.dev', 'User', 'password123'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('creates a member account for a new OAuth identity', async () => {
    const user = await service.findOrCreateFromOAuth({
      provider: AuthProvider.GOOGLE,
      providerId: 'google-123',
      email: 'oauth@tasksync.dev',
      name: 'OAuth User',
    });

    expect(user.googleId).toBe('google-123');
    expect(user.provider).toBe(AuthProvider.GOOGLE);
    expect(user.role).toBe(Role.MEMBER);
  });

  it('links an OAuth identity to an existing email account', async () => {
    const existing = makeUser({ email: 'oauth@tasksync.dev' });
    repository.findOne
      .mockResolvedValueOnce(null) // no identity match
      .mockResolvedValueOnce(existing); // email match

    const user = await service.findOrCreateFromOAuth({
      provider: AuthProvider.GITHUB,
      providerId: 'github-9',
      email: 'oauth@tasksync.dev',
      name: 'OAuth User',
    });

    expect(user.githubId).toBe('github-9');
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ githubId: 'github-9' }),
    );
  });

  it('never exposes the password hash in the public representation', () => {
    const user = makeUser({ passwordHash: 'hashed' });

    expect(service.toPublicUser(user)).not.toHaveProperty('passwordHash');
  });
});
