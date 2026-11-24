This file provides context, architectural guidelines, and coding conventions for AI coding agents working on **TaskSync**.

---

## 1. Project Overview

**TaskSync** is a real-time team chat, task collaboration, and notifications API built with **NestJS** and **TypeScript**.
It follows an event-driven, low-latency architecture where real-time communication is decoupled from database persistence and external notifications via **Redis** and **RabbitMQ**.

### Core Stack

- **Runtime & Framework:** Node.js (v20+), NestJS (TypeScript strict mode)
- **Real-Time:** Socket.io (`@nestjs/websockets`, `@nestjs/platform-socket.io`)
- **Authentication & Authorization:** Passport.js (OAuth 2.0 Google & GitHub), JWT (Access + Refresh tokens), custom RBAC Guards
- **Cache, Sessions & Presence:** Redis
- **Message Broker & Workers:** RabbitMQ
- **Primary Database:** PostgreSQL or MongoDB (via TypeORM / Prisma / Mongoose — adhere to whichever ORM is configured in `package.json`)

---

## 2. Architectural Invariants (Must Never Break)

When implementing or modifying features, strictly preserve these architectural boundaries:

1. **Non-Blocking Real-Time Hot Path:**
   - Incoming WebSocket chat messages **must** be broadcast immediately to connected clients in the target room (`server.to(roomId).emit(...)`) and pushed to the Redis room cache.
   - **Never** `await` primary database writes (PostgreSQL/MongoDB) or email/push delivery inside a Socket.io event handler. Publish an event to RabbitMQ instead.
2. **Cache-First Room History:**
   - Each room caches its **last 50 messages** in Redis (e.g., `chat:room:{roomId}:messages` using a Redis List capped with `LTRIM 0 49`).
   - Only fall back to the primary database on a cache miss or when paginating older history beyond the 50 cached items.
3. **Authenticated WebSocket Handshake:**
   - Every Socket.io connection must be authenticated during the handshake via middleware before joining any rooms. Reject unauthenticated or blacklisted tokens immediately.
4. **Presence-Aware Notifications:**
   - Before enqueueing an offline notification for `@mentions`, check user presence in Redis. Only publish to the notification queue if the user is offline.
5. **Mandatory Audit Logging:**
   - Any state-mutating action restricted to `ADMIN` or `MODERATOR` (e.g., deleting a channel, banning a user, pinning a message) must publish a structured audit event to the RabbitMQ audit queue.

---

## 3. Domain Modules & Directory Structure

Keep business logic cleanly separated by NestJS domain modules under `src/`:

```text
src/
├── auth/           # OAuth 2.0 (Google/GitHub), JWT strategy, refresh rotation, logout blacklist, RBAC guards
├── users/          # User profiles, role assignments, account lookup
├── channels/       # Channel creation, membership (room authorization); bans/pins still pending
├── chat/           # Socket.io Gateway, WS JWT middleware, presence service, event DTOs/pipes
├── redis/          # Shared Redis module (session/blacklist store, presence helpers, 50-msg LRU list)
├── rabbitmq/       # RabbitMQ connection, event publishers, queue/exchange constants
├── workers/        # Standalone or microservice consumers (persistence, offline notifications, audit logs)
└── common/         # Decorators (@Roles, @CurrentUser), DTOs, filters, interceptors, constants
```

---

## 4. Auth, Security & RBAC Rules

- **Tokens:**
- `Access Token`: Short-lived (`15m`). Checked against Redis token blacklist on protected HTTP routes and WebSocket handshakes.
- `Refresh Token`: Long-lived (`7d`). Stored/tracked in Redis to support rotation and revocation on logout.

- **Roles (`Role` enum):**
- `ADMIN`: Full control; can delete channels and ban/remove users.
- `MODERATOR`: Can pin/unpin messages and moderate channel content.
- `MEMBER`: Default role; can join authorized rooms and send messages.

- **Enforcement:**
- Always decorate protected endpoints and WebSocket handlers with `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)`.
- Verify room membership before allowing a socket to call `client.join(roomId)`.

---

## 5. Redis & RabbitMQ Conventions

### Redis Key Naming

Use consistent, colon-delimited namespaces:

- `auth:blacklist:{jti}` — Revoked access token IDs (TTL = remaining token lifetime)
- `auth:refresh:{userId}:{tokenId}` — Active refresh token sessions (TTL = `7d`)
- `presence:online` — Redis SET of online user IDs
- `presence:users` — Hash of `userId` → serialized profile (`id`, `name`, `email`, `role`) used by `users:online`
- `presence:connections:{userId}` — Active socket count so multi-tab users stay online until the last disconnect
- `chat:room:{roomId}:messages` — Capped list of the latest 50 serialized messages (`LPUSH` + `LTRIM 0 49`, newest first)

### RabbitMQ Queues

Keep queue names and payload contracts centralized in `src/rabbitmq/rabbitmq.constants.ts`:

- `chat.message.persist` — Consumed by Persistence Worker to save messages to primary DB.
- `notifications.mention.offline` — Consumed by Notification Worker to send email/push for offline `@mentions`.
- `audit.actions` — Consumed by Audit Worker to record `ADMIN`/`MODERATOR` actions.

All RabbitMQ consumers must be **idempotent** (include a unique `eventId` / `messageId` in every payload) and handle dead-lettering/retries gracefully.

---

## 6. Coding Standards & NestJS Conventions

- **TypeScript:** Strict typing everywhere. Avoid `any`; define explicit interfaces/types for WebSocket payloads, JWT claims, and RabbitMQ event contracts.
- **Validation:** Validate all incoming HTTP bodies/params with `class-validator` and `class-transformer` DTOs. Validate incoming Socket.io payloads using DTOs + `WsException` filters.
- **Configuration:** Never hardcode secrets, TTLs, or queue names. Access environment variables exclusively through NestJS `ConfigService` with schema validation on startup.
- **Error Handling:**
- Use standard NestJS HTTP exceptions (`UnauthorizedException`, `ForbiddenException`, `NotFoundException`) in REST controllers/services.
- Use `WsException` inside Socket.io gateways and middleware.

- **Testing:**
- Write unit tests (`*.spec.ts`) for services, RBAC guards, Redis cache helpers, and RabbitMQ publishers/consumers.
- Mock external infrastructure (Redis, RabbitMQ, OAuth providers, DB) in unit tests; use isolated containers/instances for integration/E2E tests (`test/*.e2e-spec.ts`).
- Integration tests boot the real `AppModule` (Postgres + Redis are required) and assert HTTP and Socket.io behaviour end to end. The e2e suite runs serially (`fileParallelism: false`) to avoid concurrent schema sync.
- Reuse `test/utils/test-app.ts` helpers (`createTestApp`, `registerUser`) instead of duplicating bootstrap logic. The app must call `listen(0)` for Socket.io tests so a real port exists.
- Do not mock Redis in integration tests: presence and room history are part of the contract.

---

## 7. Implemented API & WebSocket Contract

### HTTP (all protected routes require `Authorization: Bearer <accessToken>`)

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/github`, `GET /auth/github/callback`
- `GET /users/me` (any authenticated user); `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` (`ADMIN` only)
- `POST /channels`, `GET /channels`, `POST /channels/:id/join` (any authenticated user; creator is automatically a member)

### Socket.io

The server requires an access JWT during the handshake, sent as `auth.token` or `Authorization: Bearer <token>`. The token is verified against its signature, the Redis blacklist, and the current database user; failures close the connection with `Unauthorized`.

| Direction       | Event              | Payload → Ack / Broadcast                                                                                       |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Client → Server | `room:join`        | `{ roomId }` → ack `{ roomId, messages }` with the last 50 cached messages; the caller must be a channel member |
| Client → Server | `message:send`     | `{ roomId, content }` → ack `ChatMessage`; broadcasts `message:new` to the room and caches it immediately       |
| Client → Server | `users:online`     | ack `OnlineUser[]` read from Redis                                                                              |
| Server → Client | `message:new`      | `ChatMessage` (`id`, `roomId`, `sender`, `content`, `createdAt`)                                                |
| Server → Client | `presence:online`  | `OnlineUser` when a user's first socket connects                                                                |
| Server → Client | `presence:offline` | `{ userId }` when a user's last socket disconnects                                                              |

The socket must join a room before sending messages to it. Domain errors are thrown as `WsException` and delivered through the Socket.io `exception` event; payloads are validated with DTOs via `WsValidationPipe`.

Room IDs are channel UUIDs. Membership is checked with `ChannelsService.isMember` before `socket.join(...)`.

### Still pending (next phases)

- Message persistence, offline `@mention` notifications and audit logs in RabbitMQ (sockets currently only broadcast + cache in Redis).
- Typing indicators, channel bans/pinned messages, migrations, and an audit trail for privileged actions.

## 8. Common Commands

```bash
# Development
npm run start:dev          # Run API + WebSocket server in watch mode
npm run start:worker       # Run RabbitMQ background consumers

# Code Quality
npm run lint               # Run ESLint
npm run format             # Run Prettier
npm run build              # Compile TypeScript

# Testing
npm run test               # Run unit tests
npm run test:e2e           # Run end-to-end tests

```
