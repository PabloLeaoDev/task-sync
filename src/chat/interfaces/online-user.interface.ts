import type { Role } from '../../common/enums/role.enum.ts';

export interface OnlineUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}
