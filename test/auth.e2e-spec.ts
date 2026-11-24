import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/common/enums/role.enum.ts';
import { User } from '../src/users/entities/user.entity.ts';
import { createTestApp, registerUser } from './utils/test-app.ts';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user and returns the token pair', async () => {
    const session = await registerUser(app, 'register');

    expect(session.accessToken).toEqual(expect.any(String));
    expect(session.refreshToken).toEqual(expect.any(String));
    expect(session.tokenType).toBe('Bearer');
    expect(session.expiresIn).toBeGreaterThan(0);
    expect(session.user).toMatchObject({
      email: session.email,
      role: 'MEMBER',
    });
    expect(session.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate email', async () => {
    const session = await registerUser(app, 'duplicate');

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: session.email,
        name: 'Someone Else',
        password: 'password123',
      })
      .expect(409);
  });

  it('logs in with valid credentials and rejects a wrong password', async () => {
    const session = await registerUser(app, 'login');

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: session.email, password: session.password })
      .expect(200);
    expect(login.body.accessToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: session.email, password: 'wrong-password' })
      .expect(401);
  });

  it('serves the authenticated profile from /users/me', async () => {
    const session = await registerUser(app, 'profile');

    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: session.user.id,
      email: session.email,
      role: 'MEMBER',
    });
  });

  it('rotates refresh tokens and rejects replay of the old token', async () => {
    const session = await registerUser(app, 'refresh');

    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(session.refreshToken);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  it('blacklists the access token on logout', async () => {
    const session = await registerUser(app, 'logout');

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  it('requires authentication on protected routes', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);
  });

  it('blocks members from admin-only routes and allows promoted admins', async () => {
    const session = await registerUser(app, 'rbac');

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(403);

    // Promotion is reflected immediately because JWT validation reloads the user.
    await app
      .get(DataSource)
      .getRepository(User)
      .update(session.user.id, { role: Role.ADMIN });

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
  });
});
