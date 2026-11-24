import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { RedisService } from '../src/redis/redis.service.ts';
import {
  createTestApp,
  registerUser,
  type AuthTokens,
} from './utils/test-app.ts';

interface RoomJoined {
  roomId: string;
  messages: Array<{ content: string; sender: { id: string } }>;
}

interface ChatMessage {
  id: string;
  roomId: string;
  content: string;
  sender: { id: string; name: string };
}

interface OnlineUser {
  id: string;
  name: string;
  email: string;
}

function connectSocket(url: string, token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      auth: token ? { token } : {},
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out connecting to the WebSocket server'));
    }, 5000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function emitAck<T>(
  socket: Socket,
  event: string,
  payload?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(
      event,
      payload,
      (error: Error | null, response: T) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      },
    );
  });
}

function waitForEvent<T>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (payload: T) => {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for event ${event}`));
    }, 5000);
    socket.on(event, handler);
  });
}

async function expectWsError(
  socket: Socket,
  event: string,
  payload?: unknown,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('exception', onException);
    };
    const onException = (exception: unknown) => {
      cleanup();
      resolve(JSON.stringify(exception));
    };
    const timer = setTimeout(() => {
      socket.off('exception', onException);
      reject(new Error(`Timed out waiting for a ${event} error`));
    }, 5000);

    socket.once('exception', onException);
    socket.emit(event, payload, () => {
      cleanup();
      resolve('acknowledged');
    });
  });
}

async function clearPresence(redis: Redis): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      'presence:*',
      'COUNT',
      100,
    );
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}

async function waitForOnline(
  socket: Socket,
  userId: string,
): Promise<OnlineUser[]> {
  const deadline = Date.now() + 5000;
  let users: OnlineUser[] = [];

  while (Date.now() < deadline) {
    users = await emitAck<OnlineUser[]>(socket, 'users:online');
    if (users.some((user) => user.id === userId)) {
      return users;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return users;
}

describe('Chat (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let owner: AuthTokens & { email: string; password: string };
  let guest: AuthTokens & { email: string; password: string };
  let channelId: string;
  let redis: Redis;
  const sockets: Socket[] = [];

  const open = async (token?: string) => {
    const socket = await connectSocket(url, token);
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    });
    await clearPresence(redis);

    owner = await registerUser(app, 'chat-owner', 'Owner User');
    guest = await registerUser(app, 'chat-guest', 'Guest User');

    const channel = await request(app.getHttpServer())
      .post('/channels')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Phase 2 Room' })
      .expect(201);
    channelId = channel.body.id as string;
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    sockets.length = 0;

    // Let disconnect handlers run, then drop any remaining presence state.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await clearPresence(redis);
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
  });

  it('authenticates at the handshake and rejects missing or invalid tokens', async () => {
    await expect(connectSocket(url)).rejects.toThrow(/Unauthorized/);
    await expect(connectSocket(url, 'not-a-jwt')).rejects.toThrow(
      /Unauthorized/,
    );

    const socket = await open(owner.accessToken);
    expect(socket.connected).toBe(true);
  });

  it('rejects a blacklisted access token', async () => {
    const session = await registerUser(app, 'chat-logout');

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    await expect(connectSocket(url, session.accessToken)).rejects.toThrow(
      /Unauthorized/,
    );
  });

  it('only allows channel members to join a room', async () => {
    const outsider = await open(guest.accessToken);

    const error = await expectWsError(outsider, 'room:join', { roomId: channelId });
    expect(error).toMatch(/not a member/i);

    await request(app.getHttpServer())
      .post(`/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .expect(200);

    const joined = await emitAck<RoomJoined>(outsider, 'room:join', {
      roomId: channelId,
    });
    expect(joined.roomId).toBe(channelId);
    expect(Array.isArray(joined.messages)).toBe(true);
  });

  it('lists online users and broadcasts presence changes', async () => {
    const first = await open(owner.accessToken);
    await waitForOnline(first, owner.user.id);

    const onlineEvent = waitForEvent<OnlineUser>(
      first,
      'presence:online',
      (user) => user.id === guest.user.id,
    );

    const second = await open(guest.accessToken);
    await expect(onlineEvent).resolves.toMatchObject({ id: guest.user.id });

    const online = await waitForOnline(first, guest.user.id);
    expect(online.map((user) => user.id)).toEqual(
      expect.arrayContaining([owner.user.id, guest.user.id]),
    );

    const offlineEvent = waitForEvent<{ userId: string }>(
      first,
      'presence:offline',
      (payload) => payload.userId === guest.user.id,
    );
    second.disconnect();
    await expect(offlineEvent).resolves.toEqual({ userId: guest.user.id });
  });

  it('broadcasts messages and caches the latest history in Redis', async () => {
    await request(app.getHttpServer())
      .post(`/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .expect(200);

    const sender = await open(owner.accessToken);
    const receiver = await open(guest.accessToken);
    await emitAck<RoomJoined>(sender, 'room:join', { roomId: channelId });
    await emitAck<RoomJoined>(receiver, 'room:join', { roomId: channelId });

    const content = `Hello phase two ${Date.now()}`;
    const incoming = waitForEvent<ChatMessage>(
      receiver,
      'message:new',
      (message) => message.content === content,
    );

    const message = await emitAck<ChatMessage>(sender, 'message:send', {
      roomId: channelId,
      content,
    });
    expect(message).toMatchObject({
      roomId: channelId,
      content,
      sender: { id: owner.user.id },
    });
    await expect(incoming).resolves.toMatchObject({
      id: message.id,
      content,
    });

    const cached = await app
      .get(RedisService)
      .getList(`chat:room:${channelId}:messages`, 50);
    expect(cached.map((item) => JSON.parse(item).id)).toContain(message.id);

    const reconnected = await open(owner.accessToken);
    const history = await emitAck<RoomJoined>(reconnected, 'room:join', {
      roomId: channelId,
    });
    expect(history.messages.map((item) => item.content)).toContain(content);
  });

  it('lists only the channels the user belongs to', async () => {
    const ownerChannels = await request(app.getHttpServer())
      .get('/channels')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(
      ownerChannels.body.map((channel: { id: string }) => channel.id),
    ).toContain(channelId);

    const second = await request(app.getHttpServer())
      .post('/channels')
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .send({ name: 'Guest Only Room' })
      .expect(201);

    const ownerAfter = await request(app.getHttpServer())
      .get('/channels')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(
      ownerAfter.body.map((channel: { id: string }) => channel.id),
    ).not.toContain(second.body.id);
  });

  it('caps the Redis room history at the latest 50 messages', async () => {
    await request(app.getHttpServer())
      .post(`/channels/${channelId}/join`)
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .expect(200);

    const socket = await open(owner.accessToken);
    await emitAck<RoomJoined>(socket, 'room:join', { roomId: channelId });

    for (let index = 0; index < 52; index += 1) {
      await emitAck<ChatMessage>(socket, 'message:send', {
        roomId: channelId,
        content: `burst-${index}`,
      });
    }

    const cached = await app
      .get(RedisService)
      .getList(`chat:room:${channelId}:messages`, 50);
    expect(cached).toHaveLength(50);
    expect(JSON.parse(cached[0] as string).content).toBe('burst-51');
  });

  it('rejects messages sent before joining and blank payloads', async () => {
    const socket = await open(owner.accessToken);

    const notJoined = await expectWsError(socket, 'message:send', {
      roomId: channelId,
      content: 'too early',
    });
    expect(notJoined).toMatch(/Join the room/i);

    await emitAck<RoomJoined>(socket, 'room:join', { roomId: channelId });
    const blank = await expectWsError(socket, 'message:send', {
      roomId: channelId,
      content: '   ',
    });
    expect(blank.toLowerCase()).toMatch(/content|validation/);
  });
});
