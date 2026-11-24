import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module.ts';
import { AuthController } from './auth.controller.ts';
import { AuthService } from './auth.service.ts';
import { LocalAuthGuard } from './guards/local-auth.guard.ts';
import { GithubOAuthGuard, GoogleOAuthGuard } from './guards/oauth.guards.ts';
import { GithubStrategy } from './strategies/github.strategy.ts';
import { GoogleStrategy } from './strategies/google.strategy.ts';
import { JwtStrategy } from './strategies/jwt.strategy.ts';
import { LocalStrategy } from './strategies/local.strategy.ts';
import { TokenValidationService } from './token-validation.service.ts';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenValidationService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    GithubStrategy,
    LocalAuthGuard,
    GoogleOAuthGuard,
    GithubOAuthGuard,
  ],
  exports: [AuthService, TokenValidationService],
})
export class AuthModule {}
