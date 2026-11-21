import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.ts';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.ts';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.ts';
import { AuthService } from './auth.service.ts';
import { LoginDto } from './dto/login.dto.ts';
import { LogoutDto } from './dto/logout.dto.ts';
import { RefreshTokenDto } from './dto/refresh-token.dto.ts';
import { RegisterDto } from './dto/register.dto.ts';
import { LocalAuthGuard } from './guards/local-auth.guard.ts';
import { GithubOAuthGuard, GoogleOAuthGuard } from './guards/oauth.guards.ts';
import type { AuthResponse } from './interfaces/auth-response.interface.ts';

type OAuthRequest = Request & { user: AuthenticatedUser };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  login(@Body() _dto: LoginDto, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.login(user.id);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponse> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogoutDto,
  ): Promise<{ message: string }> {
    await this.authService.logout(user, dto.refreshToken);
    return { message: 'Logged out' };
  }

  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  googleLogin(): void {
    // Passport redirects the browser to Google.
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  async googleCallback(
    @Req() req: OAuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.completeOAuthLogin(req.user, res);
  }

  @Get('github')
  @UseGuards(GithubOAuthGuard)
  githubLogin(): void {
    // Passport redirects the browser to GitHub.
  }

  @Get('github/callback')
  @UseGuards(GithubOAuthGuard)
  async githubCallback(
    @Req() req: OAuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.completeOAuthLogin(req.user, res);
  }

  /**
   * Returns the tokens as JSON, or redirects to the configured frontend URL
   * with the tokens when `OAUTH_SUCCESS_REDIRECT_URL` is set.
   */
  private async completeOAuthLogin(
    user: AuthenticatedUser,
    res: Response,
  ): Promise<void> {
    const result = await this.authService.login(user.id);
    const redirectUrl = this.config.get<string>('OAUTH_SUCCESS_REDIRECT_URL');

    if (redirectUrl) {
      try {
        const url = new URL(redirectUrl);
        url.searchParams.set('accessToken', result.accessToken);
        url.searchParams.set('refreshToken', result.refreshToken);
        res.redirect(url.toString());
        return;
      } catch {
        // Fall through to JSON when the configured URL is invalid.
      }
    }

    res.json(result);
  }
}
