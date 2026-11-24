import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.ts';
import { TokenValidationService } from '../token-validation.service.ts';
import type { JwtAccessPayload } from '../interfaces/jwt-payload.interface.ts';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly tokenValidationService: TokenValidationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtAccessPayload): Promise<AuthenticatedUser> {
    return this.tokenValidationService.validatePayload(payload);
  }
}
