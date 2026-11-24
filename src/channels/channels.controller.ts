import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.ts';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.ts';
import { ChannelsService } from './channels.service.ts';
import { CreateChannelDto } from './dto/create-channel.dto.ts';
import type { Channel } from './entities/channel.entity.ts';

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  create(
    @Body() dto: CreateChannelDto,
    @CurrentUser('id') userId: string,
  ): Promise<Channel> {
    return this.channelsService.create(dto, userId);
  }

  @Get()
  findMine(@CurrentUser('id') userId: string): Promise<Channel[]> {
    return this.channelsService.findMine(userId);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  async join(
    @Param('id', ParseUUIDPipe) channelId: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ channelId: string; joined: true }> {
    await this.channelsService.join(channelId, userId);
    return { channelId, joined: true };
  }
}
