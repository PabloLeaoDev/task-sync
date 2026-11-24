import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsController } from './channels.controller.ts';
import { ChannelsService } from './channels.service.ts';
import { ChannelMember } from './entities/channel-member.entity.ts';
import { Channel } from './entities/channel.entity.ts';

@Module({
  imports: [TypeOrmModule.forFeature([Channel, ChannelMember])],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
