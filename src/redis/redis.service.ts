import {
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Thin wrapper around the shared Redis connection. Auth uses it for token
 * blacklisting and refresh sessions; later phases reuse it for presence and
 * room caches.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(config.get('REDIS_PORT', 6379)),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) > 0;
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Atomically reads and removes a key. Used to consume refresh sessions
   * exactly once during rotation.
   */
  async take(key: string): Promise<string | null> {
    return this.client.getdel(key);
  }

  async addToSet(key: string, member: string): Promise<void> {
    await this.client.sadd(key, member);
  }

  async removeFromSet(key: string, member: string): Promise<void> {
    await this.client.srem(key, member);
  }

  async getSetMembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async setHashField(
    key: string,
    field: string,
    value: string,
  ): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async getHashFields(
    key: string,
    fields: string[],
  ): Promise<(string | null)[]> {
    if (fields.length === 0) {
      return [];
    }
    return this.client.hmget(key, ...fields);
  }

  async deleteHashField(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }

  async increment(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decrement(key: string): Promise<number> {
    return this.client.decr(key);
  }

  /** Pushes to the head of a list and keeps only the newest `maxLength` items. */
  async pushCappedList(
    key: string,
    value: string,
    maxLength: number,
  ): Promise<void> {
    await this.client
      .multi()
      .lpush(key, value)
      .ltrim(key, 0, maxLength - 1)
      .exec();
  }

  async getList(key: string, maxLength: number): Promise<string[]> {
    return this.client.lrange(key, 0, maxLength - 1);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
