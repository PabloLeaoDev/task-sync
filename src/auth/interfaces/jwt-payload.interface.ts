import type { Role } from '../../common/enums/role.enum.ts';

export interface JwtAccessPayload {
  sub: string;
  email: string;
  role: Role;
  jti: string;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  jti: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}
