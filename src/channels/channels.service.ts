import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CreateChannelDto } from './dto/create-channel.dto.ts';
import { ChannelMember } from './entities/channel-member.entity.ts';
import { Channel } from './entities/channel.entity.ts';

/**
 * Channels are the rooms clients join over Socket.io. Membership is verified
 * before a socket is allowed into a room.
 */
@Injectable()
export class ChannelsService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelsRepository: Repository<Channel>,
    @InjectRepository(ChannelMember)
    private readonly membersRepository: Repository<ChannelMember>,
  ) {}

  async create(dto: CreateChannelDto, ownerId: string): Promise<Channel> {
    const channel = await this.channelsRepository.save(
      this.channelsRepository.create({ name: dto.name, ownerId }),
    );
    await this.membersRepository.save(
      this.membersRepository.create({ channelId: channel.id, userId: ownerId }),
    );
    return channel;
  }

  async findMine(userId: string): Promise<Channel[]> {
    return this.channelsRepository
      .createQueryBuilder('channel')
      .innerJoin(
        ChannelMember,
        'member',
        'member.channel_id = channel.id AND member.user_id = :userId',
        { userId },
      )
      .orderBy('channel.created_at', 'ASC')
      .getMany();
  }

  /** Idempotent: joining an already joined channel succeeds. */
  async join(channelId: string, userId: string): Promise<void> {
    const channelExists = await this.channelsRepository.exists({
      where: { id: channelId },
    });
    if (!channelExists) {
      throw new NotFoundException('Channel not found');
    }

    await this.membersRepository.upsert({ channelId, userId }, [
      'channelId',
      'userId',
    ]);
  }

  async isMember(channelId: string, userId: string): Promise<boolean> {
    return this.membersRepository.exists({
      where: { channelId, userId },
    });
  }
}
