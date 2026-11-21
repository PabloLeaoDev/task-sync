import { IsJWT, IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  /** Optional refresh token, revoked along with the access token. */
  @IsOptional()
  @IsString()
  @IsJWT()
  refreshToken?: string;
}
