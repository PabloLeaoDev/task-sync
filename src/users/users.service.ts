import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum.ts';
import type { CreateUserDto } from './dto/create-user.dto.ts';
import type { UpdateUserDto } from './dto/update-user.dto.ts';
import { User } from './entities/user.entity.ts';
import { AuthProvider } from './enums/auth-provider.enum.ts';
import type { OAuthProfile } from './interfaces/oauth-profile.interface.ts';
import type { PublicUser } from './interfaces/public-user.interface.ts';

@Injectable()
export class UsersService {
  private readonly saltRounds: number;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    config: ConfigService,
  ) {
    this.saltRounds = Number(config.get('BCRYPT_SALT_ROUNDS', 12));
  }

  async create(dto: CreateUserDto): Promise<User> {
    return this.createLocalUser(
      dto.email,
      dto.name,
      dto.password,
      dto.role ?? Role.MEMBER,
      dto.avatarUrl ?? null,
    );
  }

  async createLocalUser(
    email: string,
    name: string,
    password: string,
    role: Role = Role.MEMBER,
    avatarUrl: string | null = null,
  ): Promise<User> {
    const normalizedEmail = this.normalizeEmail(email);
    await this.assertEmailIsFree(normalizedEmail);

    const passwordHash = await bcrypt.hash(password, this.saltRounds);

    return this.save({
      email: normalizedEmail,
      name,
      passwordHash,
      provider: AuthProvider.LOCAL,
      role,
      avatarUrl,
    });
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({ order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email: this.normalizeEmail(email) },
    });
  }

  /** Includes the password hash, which is excluded by default on the entity. */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: this.normalizeEmail(email) })
      .getOne();
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findByIdOrFail(id);

    if (dto.email && this.normalizeEmail(dto.email) !== user.email) {
      const email = this.normalizeEmail(dto.email);
      await this.assertEmailIsFree(email);
      user.email = email;
    }

    if (dto.name !== undefined) {
      user.name = dto.name;
    }

    if (dto.password !== undefined) {
      user.passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    }

    if (dto.role !== undefined) {
      user.role = dto.role;
    }

    if (dto.avatarUrl !== undefined) {
      user.avatarUrl = dto.avatarUrl;
    }

    return this.save(user);
  }

  async remove(id: string): Promise<void> {
    const result = await this.usersRepository.delete(id);
    if (!result.affected) {
      throw new NotFoundException('User not found');
    }
  }

  /**
   * Finds or creates the account behind an OAuth profile, linking the
   * provider identity to an existing account with the same verified email.
   */
  async findOrCreateFromOAuth(profile: OAuthProfile): Promise<User> {
    const email = this.normalizeEmail(profile.email);
    const identityColumn =
      profile.provider === AuthProvider.GOOGLE ? 'googleId' : 'githubId';

    let user = await this.usersRepository.findOne({
      where: { [identityColumn]: profile.providerId },
    });

    if (!user) {
      user = await this.findByEmail(email);
    }

    if (!user) {
      return this.save({
        email,
        name: profile.name,
        passwordHash: null,
        provider: profile.provider,
        [identityColumn]: profile.providerId,
        avatarUrl: profile.avatarUrl ?? null,
        role: Role.MEMBER,
      });
    }

    const linkedId = user[identityColumn];
    if (linkedId && linkedId !== profile.providerId) {
      throw new ConflictException(
        'This email is already linked to a different account on this provider',
      );
    }

    let changed = false;
    if (!linkedId) {
      user[identityColumn] = profile.providerId;
      changed = true;
    }
    if (!user.avatarUrl && profile.avatarUrl) {
      user.avatarUrl = profile.avatarUrl;
      changed = true;
    }

    return changed ? this.save(user) : user;
  }

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      provider: user.provider,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async assertEmailIsFree(email: string): Promise<void> {
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }
  }

  private async save(data: Partial<User>): Promise<User> {
    try {
      return await this.usersRepository.save(this.usersRepository.create(data));
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    const candidate = error as {
      code?: string;
      driverError?: { code?: string };
    };
    return (
      candidate?.code === '23505' || candidate?.driverError?.code === '23505'
    );
  }
}
