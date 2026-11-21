import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.ts';
import { Roles } from '../common/decorators/roles.decorator.ts';
import { Role } from '../common/enums/role.enum.ts';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.ts';
import { RolesGuard } from '../common/guards/roles.guard.ts';
import { CreateUserDto } from './dto/create-user.dto.ts';
import { UpdateUserDto } from './dto/update-user.dto.ts';
import type { PublicUser } from './interfaces/public-user.interface.ts';
import { UsersService } from './users.service.ts';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser('id') userId: string): Promise<PublicUser> {
    const user = await this.usersService.findByIdOrFail(userId);
    return this.usersService.toPublicUser(user);
  }

  @Get()
  @Roles(Role.ADMIN)
  async findAll(): Promise<PublicUser[]> {
    const users = await this.usersService.findAll();
    return users.map((user) => this.usersService.toPublicUser(user));
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    const user = await this.usersService.findByIdOrFail(id);
    return this.usersService.toPublicUser(user);
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: CreateUserDto): Promise<PublicUser> {
    const user = await this.usersService.create(dto);
    return this.usersService.toPublicUser(user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<PublicUser> {
    const user = await this.usersService.update(id, dto);
    return this.usersService.toPublicUser(user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') currentUserId: string,
  ): Promise<{ message: string }> {
    if (id === currentUserId) {
      throw new ForbiddenException('Admins cannot delete their own account');
    }

    await this.usersService.remove(id);
    return { message: 'User deleted' };
  }
}
