import { Logger, UsePipes } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { ChannelsService } from '../channels/channels.service.ts';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.ts';
import { RedisService } from '../redis/redis.service.ts';
import { JoinRoomDto } from './dto/join-room.dto.ts';
import { SendMessageDto } from './dto/send-message.dto.ts';
import type { ChatMessage } from './interfaces/chat-message.interface.ts';
import type { OnlineUser } from './interfaces/online-user.interface.ts';
import { WsValidationPipe } from './pipes/ws-validation.pipe.ts';
import { PresenceService } from './presence.service.ts';
import { socketUser, WsJwtMiddleware } from './ws-jwt.middleware.ts';

const ROOM_HISTORY_LIMIT = 50;
const ROOM_CACHE_PREFIX = 'chat:room';

interface RoomJoined {
  roomId: string;
  messages: ChatMessage[];
}

@WebSocketGateway()
@UsePipes(new WsValidationPipe())
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly wsJwtMiddleware: WsJwtMiddleware,
    private readonly presenceService: PresenceService,
    private readonly channelsService: ChannelsService,
    private readonly redisService: RedisService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.wsJwtMiddleware.use(socket, next);
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const user = socket.data.user as AuthenticatedUser | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    try {
      const { user: onlineUser, becameOnline } =
        await this.presenceService.connect(user);

      if (becameOnline) {
        this.server.emit('presence:online', onlineUser);
      }
    } catch (error) {
      this.logger.error(
        `Failed to register presence for ${user.id}: ${this.messageOf(error)}`,
      );
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const user = socket.data.user as AuthenticatedUser | undefined;
    if (!user) {
      return;
    }

    try {
      const { becameOffline } = await this.presenceService.disconnect(user.id);
      if (becameOffline) {
        this.server.emit('presence:offline', { userId: user.id });
      }
    } catch (error) {
      this.logger.error(
        `Failed to remove presence for ${user.id}: ${this.messageOf(error)}`,
      );
    }
  }

  @SubscribeMessage('room:join')
  async handleJoinRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: JoinRoomDto,
  ): Promise<RoomJoined> {
    const user = socketUser(socket);
    const isMember = await this.channelsService.isMember(dto.roomId, user.id);
    if (!isMember) {
      throw new WsException('You are not a member of this room');
    }

    await socket.join(dto.roomId);
    return {
      roomId: dto.roomId,
      messages: await this.getCachedHistory(dto.roomId),
    };
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: SendMessageDto,
  ): Promise<ChatMessage> {
    if (!socket.rooms.has(dto.roomId)) {
      throw new WsException('Join the room before sending messages');
    }

    const user = socketUser(socket);
    const message: ChatMessage = {
      id: randomUUID(),
      roomId: dto.roomId,
      sender: { id: user.id, name: user.name },
      content: dto.content.trim(),
      createdAt: new Date().toISOString(),
    };

    // Broadcast first: real-time delivery never waits on cache or persistence.
    this.server.to(dto.roomId).emit('message:new', message);

    try {
      await this.redisService.pushCappedList(
        this.historyKey(dto.roomId),
        JSON.stringify(message),
        ROOM_HISTORY_LIMIT,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to cache message in ${dto.roomId}: ${this.messageOf(error)}`,
      );
    }

    return message;
  }

  @SubscribeMessage('users:online')
  async handleOnlineUsers(): Promise<OnlineUser[]> {
    return this.presenceService.listOnline();
  }

  private async getCachedHistory(roomId: string): Promise<ChatMessage[]> {
    try {
      const cached = await this.redisService.getList(
        this.historyKey(roomId),
        ROOM_HISTORY_LIMIT,
      );
      return cached.flatMap((value) => {
        try {
          return [JSON.parse(value) as ChatMessage];
        } catch {
          return [];
        }
      });
    } catch (error) {
      this.logger.warn(
        `Failed to read room history for ${roomId}: ${this.messageOf(error)}`,
      );
      return [];
    }
  }

  private historyKey(roomId: string): string {
    return `${ROOM_CACHE_PREFIX}:${roomId}:messages`;
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
