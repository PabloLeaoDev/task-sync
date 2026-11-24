import {
  Injectable,
  ValidationPipe,
  type ValidationPipeOptions,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { ValidationError } from 'class-validator';

/** ValidationPipe variant that reports failures as WsException. */
@Injectable()
export class WsValidationPipe extends ValidationPipe {
  constructor(options: ValidationPipeOptions = {}) {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      ...options,
      exceptionFactory: (errors: ValidationError[]) =>
        new WsException(
          errors
            .flatMap((error) => Object.values(error.constraints ?? {}))
            .join('; ') || 'Validation failed',
        ),
    });
  }
}
