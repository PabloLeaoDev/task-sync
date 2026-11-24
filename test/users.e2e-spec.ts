import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../src/common/enums/role.enum.ts';
import { User } from '../src/users/entities/user.entity.ts';
import {
  createTestApp,
  registerUser,
  uniqueEmail,
} from './utils/test-app.ts';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminId: string;
  let memberToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    const admin = await registerUser(app, 'admin', 'Admin User');
    adminId = admin.user.id;
    await app
      .get(DataSource)
      .getRepository(User)
      .update(adminId, { role: Role.ADMIN });
    adminToken = admin.accessToken;

    const member = await registerUser(app, 'member', 'Member User');
    memberToken = member.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('forbids members from listing users', async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('allows admins to create, read, update and delete users', async () => {
    const email = uniqueEmail('managed');

    const created = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        name: 'Managed User',
        password: 'password123',
        role: Role.MODERATOR,
      })
      .expect(201);

    expect(created.body).toMatchObject({ email, role: Role.MODERATOR });
    expect(created.body).not.toHaveProperty('passwordHash');
    const id = created.body.id as string;

    const list = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.some((user: { id: string }) => user.id === id)).toBe(true);

    const fetched = await request(app.getHttpServer())
      .get(`/users/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(fetched.body.id).toBe(id);

    const updated = await request(app.getHttpServer())
      .patch(`/users/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Renamed User' })
      .expect(200);
    expect(updated.body.name).toBe('Renamed User');

    await request(app.getHttpServer())
      .delete(`/users/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/users/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('refuses to let an admin delete their own account', async () => {
    await request(app.getHttpServer())
      .delete(`/users/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  it('validates and rejects malformed payloads', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email', name: '', password: 'short' })
      .expect(400);
  });
});
