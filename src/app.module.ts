import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.ts';
import { AppService } from './app.service.ts';
import { AuthModule } from './auth/auth.module.ts';
import { ChannelsModule } from './channels/channels.module.ts';
import { ChatModule } from './chat/chat.module.ts';
import { validateEnv } from './config/env.validation.ts';
import { RedisModule } from './redis/redis.module.ts';
import { UsersModule } from './users/users.module.ts';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // Migrations are recommended for production deployments.
        synchronize: config.get<string>('NODE_ENV') !== 'production',
        ssl:
          config.get<string>('DATABASE_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
    RedisModule,
    UsersModule,
    AuthModule,
    ChannelsModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
