import { CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('channel_members')
export class ChannelMember {
  @PrimaryColumn({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Index()
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt!: Date;
}
