import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.ts';
import { RedisService } from '../redis/redis.service.ts';
import type { OnlineUser } from './interfaces/online-user.interface.ts';

const ONLINE_SET = 'presence:online';
const ONLINE_USERS = 'presence:users';
const CONNECTIONS_PREFIX = 'presence:connections';

/**
 * Tracks online users in Redis. A user stays online while at least one
 * socket is connected (multi-tab / multi-device aware).
 */
@Injectable()
export class PresenceService {
  constructor(private readonly redisService: RedisService) {}

  async connect(
    user: AuthenticatedUser,
  ): Promise<{ user: OnlineUser; becameOnline: boolean }> {
    const onlineUser: OnlineUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    const connections = await this.redisService.increment(
      `${CONNECTIONS_PREFIX}:${user.id}`,
    );
    await this.redisService.addToSet(ONLINE_SET, user.id);
    await this.redisService.setHashField(
      ONLINE_USERS,
      user.id,
      JSON.stringify(onlineUser),
    );

    return { user: onlineUser, becameOnline: connections === 1 };
  }

  async disconnect(userId: string): Promise<{ becameOffline: boolean }> {
    const connections = await this.redisService.decrement(
      `${CONNECTIONS_PREFIX}:${userId}`,
    );
    if (connections > 0) {
      return { becameOffline: false };
    }

    await this.redisService.delete(`${CONNECTIONS_PREFIX}:${userId}`);
    await this.redisService.removeFromSet(ONLINE_SET, userId);
    await this.redisService.deleteHashField(ONLINE_USERS, userId);
    return { becameOffline: true };
  }

  async listOnline(): Promise<OnlineUser[]> {
    const ids = await this.redisService.getSetMembers(ONLINE_SET);
    if (ids.length === 0) {
      return [];
    }

    const values = await this.redisService.getHashFields(ONLINE_USERS, ids);
    return values
      .filter((value): value is string => value !== null)
      .map((value) => JSON.parse(value) as OnlineUser)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
