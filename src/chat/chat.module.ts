import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.ts';
import { ChannelsModule } from '../channels/channels.module.ts';
import { ChatGateway } from './chat.gateway.ts';
import { PresenceService } from './presence.service.ts';
import { WsJwtMiddleware } from './ws-jwt.middleware.ts';

@Module({
  imports: [AuthModule, ChannelsModule],
  providers: [ChatGateway, WsJwtMiddleware, PresenceService],
})
export class ChatModule {}
