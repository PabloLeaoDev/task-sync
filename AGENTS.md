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
├── channels/       # Project/channel CRUD, membership, bans, pinned messages
├── chat/           # Socket.io Gateway, WS JWT middleware, room lifecycle, typing & presence events
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
- `presence:online` or `presence:user:{userId}` — Online status tracking (with TTL heartbeat)
- `chat:room:{roomId}:messages` — Capped list of the latest 50 serialized messages

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

---

## 7. Common Commands

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
