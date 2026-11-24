# TaskSync

**TaskSync** is a real-time team chat and notifications API built with **NestJS**, inspired by a streamlined Slack or Discord architecture tailored for project and task-oriented teams. It combines low-latency WebSocket messaging, role-based access control, Redis-backed session and presence state, and RabbitMQ asynchronous workers so real-time delivery never waits on database writes or external notifications.

---

## Key Features

- **Authentication & Authorization (JWT + OAuth 2.0)**
- **Social Login:** Sign in via **Google** or **GitHub** using OAuth 2.0.
- **Dual-Token Strategy:** Short-lived **Access Tokens** (e.g., 15 minutes) paired with long-lived **Refresh Tokens** (e.g., 7 days).
- **Role-Based Access Control (RBAC):** Fine-grained permissions across three roles:
- `ADMIN`: Delete channels and ban/remove users.
- `MODERATOR`: Pin messages and enforce channel moderation rules.
- `MEMBER`: Send messages and participate in assigned project rooms.

- **Redis (Sessions, Presence & History Cache)**
- **Session & Token Blacklist:** Track active refresh sessions or blacklist revoked access tokens when users log out before expiration.
- **Online Presence:** Maintain real-time online/offline user status using Redis Sets or TTL-expiring keys.
- **Message History Cache:** Cache the **last 50 messages** per room to avoid heavy primary database reads when users join or load a channel.

- **Real-Time WebSockets (Socket.io)**
- **Authenticated Handshake:** Validate JWT credentials at socket connection time via Socket.io middleware before allowing room joins.
- **Project & Channel Rooms:** Isolate conversations by project or channel (e.g., `socket.join('projeto-123')`).
- **Instant Events:** Broadcast chat messages, typing indicators (`user is typing...`), and live presence updates (`online` / `offline`).

- **Asynchronous Messaging & Workers (RabbitMQ)**
- **Non-Blocking Message Persistence:** Immediately emit incoming socket messages to online room members while publishing a persistence job to RabbitMQ for a background worker to write to the primary database (**PostgreSQL** or **MongoDB**).
- **Offline Mentions & Notifications:** When a user is mentioned (e.g., `@joao`) and not marked as online in Redis, enqueue a notification event to trigger an email or push notification.
- **Audit Logs:** Route high-impact actions (e.g., _"Admin removed user X"_) to a dedicated RabbitMQ audit queue.

---

## Architecture Overview

```text
Client (Web / Mobile)
  │
  ├── REST / OAuth 2.0 ────────► NestJS API (JWT Auth, RBAC Guards, Channels/Users)
  │                                  │
  └── Socket.io (JWT Middleware) ────┼──► Redis (Sessions/Blacklist, Presence, Last 50 Msgs)
                                     │
                                     └──► RabbitMQ
                                            ├──► Persistence Worker ──► PostgreSQL / MongoDB
                                            ├──► Notification Worker ─► Email / Push Service
                                            └──► Audit Worker ────────► Audit Log Store

```

### Message & Event Flow

1. **Connection & Auth:** A client authenticates via OAuth 2.0 (Google/GitHub) or credentials to receive an Access Token and Refresh Token, then connects over Socket.io with the JWT verified in middleware.
2. **Joining a Room:** The client joins a project/channel room (e.g., `projeto-123`) and fetches recent history from the **Redis** cache (falling back to the primary database on a cache miss).
3. **Sending a Message:**

- The NestJS gateway broadcasts the message immediately to connected clients in the room.
- A message-persistence event is published to **RabbitMQ** so a worker persists it asynchronously to **PostgreSQL** or **MongoDB**.

4. **Mentions & Presence:** If `@username` is detected, the system checks **Redis** presence; if offline, it publishes an event to the **RabbitMQ** notification queue.
5. **Privileged Actions:** Actions guarded by RBAC (`ADMIN` / `MODERATOR`) emit structured events to a dedicated **RabbitMQ** audit queue.

---

## Tech Stack

- **Framework:** [NestJS](https://nestjs.com/) (Node.js / TypeScript)
- **Real-Time Transport:** [Socket.io](https://socket.io/) (WebSockets with rooms & middleware)
- **Auth & Security:** OAuth 2.0 (Google & GitHub strategies), JWT (`access_token` + `refresh_token`), RBAC guards
- **In-Memory Store:** [Redis](https://redis.io/) (token blacklist/sessions, presence sets/TTLs, 50-message room cache)
- **Message Broker:** [RabbitMQ](https://www.rabbitmq.com/) (asynchronous workers for persistence, offline notifications, and audit logs)
- **Primary Database:** PostgreSQL or MongoDB

---

## Environment Variables

Configure your `.env` file (see `.env.example`) before running the application:

```env
# Application
NODE_ENV=development
PORT=3000

# JWT & OAuth 2.0
JWT_ACCESS_SECRET=your_access_token_secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your_refresh_token_secret
JWT_REFRESH_EXPIRES_IN=7d

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672

# Primary Database (PostgreSQL or MongoDB)
DATABASE_URL=postgresql://user:password@localhost:5432/tasksync

```

---

## Getting Started

### Prerequisites

- Node.js (v20+ recommended) & npm / pnpm
- Redis instance
- RabbitMQ broker
- PostgreSQL or MongoDB instance

### Installation & Running

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables and fill in your values
cp .env.example .env

# 3. Start the API server in development mode
npm run start:dev

# 4. Start RabbitMQ background workers (depending on how workers are structured/deployed)
npm run start:worker

```

---

## Implemented API

All routes below require `Authorization: Bearer <accessToken>` unless noted otherwise.

- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`; OAuth at `GET /auth/google` and `GET /auth/github` (plus callbacks).
- **Users:** `GET /users/me`; admin-only `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id`.
- **Channels:** `POST /channels`, `GET /channels`, `POST /channels/:id/join`. The creator becomes a member automatically.

### WebSocket Events

Connect with the access token in `auth.token` (or an `Authorization: Bearer` header). Unauthenticated, invalid or blacklisted tokens are rejected during the handshake.

| Event | Direction | Payload | Result |
| --- | --- | --- | --- |
| `room:join` | client → server | `{ roomId }` | Ack with `{ roomId, messages }` (last 50 cached); requires channel membership |
| `message:send` | client → server | `{ roomId, content }` | Ack with the message, broadcasts `message:new`, caches it in Redis |
| `users:online` | client → server | — | Ack with the online users list from Redis |
| `message:new` | server → client | `ChatMessage` | Real-time message for the room |
| `presence:online` / `presence:offline` | server → client | `OnlineUser` / `{ userId }` | Live presence changes |

Domain errors are emitted through Socket.io's `exception` event.

---

## Domain Modules

- `auth/` — OAuth 2.0 (Google/GitHub), JWT issuance/rotation, logout/blacklist integration, token validation, and RBAC guards/decorators.
- `users/` — User profiles, roles, and account lookup.
- `channels/` — Channel creation and membership used to authorize room joins. Bans and pinned messages are still planned.
- `chat/` — Socket.io gateway, handshake JWT middleware, room join/messaging, Redis presence and 50-message room cache. Typing indicators are still planned.
- `messaging/` (RabbitMQ) — Not implemented yet: database message persistence, offline `@mention` notifications, and audit logging.
