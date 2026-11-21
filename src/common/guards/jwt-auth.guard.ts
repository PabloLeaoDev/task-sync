import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Protects HTTP routes with the `jwt` passport strategy.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
