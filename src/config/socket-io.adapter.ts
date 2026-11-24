import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/** Applies `CORS_ORIGIN` to Socket.io after ConfigModule has loaded `.env`. */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(private readonly context: INestApplicationContext) {
    super(context);
  }

  createIOServer(port: number | undefined, options?: ServerOptions): Server {
    const origin =
      this.context.get(ConfigService).get<string>('CORS_ORIGIN') || '*';
    // Nest's signature expects fully materialized ServerOptions while socket.io
    // itself accepts partial options.
    return super.createIOServer(port, {
      ...options,
      cors: { origin },
    } as unknown as ServerOptions);
  }
}
