import {
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  roomId!: string;

  @IsString()
  @Length(1, 2000)
  @Matches(/\S/, { message: 'content must not be blank' })
  content!: string;
}
