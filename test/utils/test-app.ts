import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.ts';
import { ConfiguredIoAdapter } from '../../src/config/socket-io.adapter.ts';

/** Boots the real application (Postgres + Redis) with production pipes. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@tasksync.test`;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export async function registerUser(
  app: INestApplication,
  prefix = 'user',
  name = 'Test User',
  password = 'password123',
): Promise<AuthTokens & { email: string; password: string }> {
  const email = uniqueEmail(prefix);
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, name, password })
    .expect(201);

  return {
    ...(response.body as AuthTokens),
    email,
    password,
  };
}
