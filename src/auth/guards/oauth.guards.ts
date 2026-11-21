import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleOAuthGuard
  extends AuthGuard('google')
  implements CanActivate
{
  constructor(private readonly config: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!this.config.get<string>('GOOGLE_CLIENT_ID')) {
      throw new ServiceUnavailableException('Google OAuth is not configured');
    }
    return super.canActivate(context);
  }
}

@Injectable()
export class GithubOAuthGuard
  extends AuthGuard('github')
  implements CanActivate
{
  constructor(private readonly config: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!this.config.get<string>('GITHUB_CLIENT_ID')) {
      throw new ServiceUnavailableException('GitHub OAuth is not configured');
    }
    return super.canActivate(context);
  }
}
