import { IsString, Length, Matches } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  @Length(1, 80)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;
}
