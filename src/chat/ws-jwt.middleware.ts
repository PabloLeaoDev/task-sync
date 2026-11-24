import { Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface.ts';
import { TokenValidationService } from '../auth/token-validation.service.ts';

/**
 * Runs before any Socket.io connection is accepted. The access token may be
 * sent as `auth.token` or as an `Authorization: Bearer <token>` header.
 */
@Injectable()
export class WsJwtMiddleware {
  constructor(
    private readonly tokenValidationService: TokenValidationService,
  ) {}

  async use(socket: Socket, next: (error?: Error) => void): Promise<void> {
    try {
      const token = this.extractToken(socket);
      if (!token) {
        throw new Error('Missing token');
      }

      const user = await this.tokenValidationService.validateAccessToken(token);
      socket.data.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  }

  private extractToken(socket: Socket): string | null {
    const authToken = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      return authToken;
    }

    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim();
    }

    return null;
  }
}

export function socketUser(socket: Socket): AuthenticatedUser {
  return socket.data.user as AuthenticatedUser;
}
