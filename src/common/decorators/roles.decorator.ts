import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum.ts';

export const ROLES_KEY = 'roles';

/**
 * Declares which roles may access a route. Enforced by `RolesGuard`.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
