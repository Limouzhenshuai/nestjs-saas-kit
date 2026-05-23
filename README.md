# NestJS SaaS Kit

A production-ready SaaS boilerplate built with **NestJS 11**, featuring JWT authentication, Role-Based Access Control (RBAC), and Stripe subscription billing.

## Features

- **Authentication** — Register, login, JWT access + refresh tokens, bcrypt password hashing
- **Role-Based Access Control** — Roles guard (`USER`, `ADMIN`, `CREATOR`) with decorator-based role assignment
- **Stripe Payments** — Checkout sessions, subscription lifecycle management, webhook verification
- **Subscription Management** — Create checkout, view current plan, cancel at period end, change plan mid-cycle
- **Stripe Webhook Handling** — Signature verification in production, mock mode for local development
- **API Security** — All subscription endpoints protected by `JwtAuthGuard`, webhook endpoint secured by Stripe signature
- **Swagger Documentation** — Interactive API docs at `/api/docs`
- **Health Check** — `GET /health` endpoint for deployment monitoring
- **Docker Support** — Multi-stage Dockerfile + docker-compose with PostgreSQL and Redis
- **Global Error Handling** — Unified error response format across all endpoints

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [NestJS 11](https://nestjs.com/) |
| Language | TypeScript 5 |
| Database | PostgreSQL (production), SQLite (testing) |
| ORM | [Prisma 7](https://www.prisma.io/) with driver adapters |
| Auth | Passport.js (JWT + Local strategies), bcrypt |
| Payments | Stripe SDK v22 |
| Validation | class-validator + class-transformer |
| Testing | Jest, Supertest |

## Project Structure

```
src/
├── auth/               # Authentication module
│   ├── decorators/     # @CurrentUser(), @Roles()
│   ├── dto/            # RegisterDto, LoginDto, RefreshTokenDto
│   ├── guards/         # JwtAuthGuard, LocalAuthGuard, RolesGuard
│   └── strategies/     # JwtStrategy, LocalStrategy
├── common/             # Shared filters (exception filter)
├── prisma/             # Prisma service + module
├── stripe/             # Stripe integration module
│   ├── webhook/        # StripeWebhookController + StripeWebhookService
│   └── stripe.service.ts
└── subscription/       # Subscription CRUD module
prisma/
├── schema.prisma       # Production schema (PostgreSQL)
└── schema.test.prisma  # Test schema (SQLite)
test/
├── jest-e2e.json       # E2E test config
├── app.e2e-spec.ts     # App smoke test
└── stripe.e2e-spec.ts  # Stripe + Subscription E2E tests
```

## Quick Start

### Prerequisites

- Node.js >= 20
- PostgreSQL (running locally or remote)
- Redis (for token blacklisting, optional)

### Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd nestjs-saas-kit

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env with your values (see Environment Variables below)

# 4. Set up the database
npx prisma generate
npx prisma db push

# 5. Start the development server
npm run start:dev
```

The server starts at `http://localhost:3000`.

**Swagger docs**: http://localhost:3000/api/docs
**Health check**: `GET http://localhost:3000/health`

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nestjs_saas_kit

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRATION=15m

# Redis (optional)
REDIS_URL=redis://localhost:6379

# Stripe (test mode) — https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx   # Leave empty for mock mode
STRIPE_PRICE_ID=price_test_placeholder              # Default price ID

# Client URL (used for Stripe success/cancel redirects)
CLIENT_URL=http://localhost:3000
```

> **Webhook Mock Mode**: When `STRIPE_WEBHOOK_SECRET` is empty, the webhook endpoint accepts unverified JSON payloads for local development.

## API Reference

### Auth — `POST /auth`

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /auth/register` | None | Register a new user |
| `POST /auth/login` | Local | Login with email + password |
| `POST /auth/refresh` | None | Refresh access token |
| `POST /auth/logout` | JWT | Invalidate refresh token |

**Register**

```json
// POST /auth/register
{ "email": "user@example.com", "password": "securepass", "name": "User" }
```

**Login**

```json
// POST /auth/login
{ "email": "user@example.com", "password": "securepass" }
// Response: { "access_token": "...", "refresh_token": "..." }
```

### Subscriptions — `POST /subscriptions` (all JWT-protected)

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /subscriptions` | JWT | Create a checkout session |
| `GET /subscriptions/current` | JWT | Get current subscription |
| `DELETE /subscriptions` | JWT | Cancel at period end |
| `PATCH /subscriptions/plan` | JWT | Change subscription plan |

**Create Checkout**

```json
// POST /subscriptions
{ "priceId": "price_xxxxxxxxxxxxx" }
// Response: { "url": "https://checkout.stripe.com/...", "sessionId": "cs_..." }
```

### Stripe Webhook — `POST /stripe/webhook`

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /stripe/webhook` | Stripe signature | Receive Stripe events |

Handles: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

Send a `Stripe-Signature` header in production, or a raw JSON body in mock mode (no signature required when `STRIPE_WEBHOOK_SECRET` is empty).

```json
// POST /stripe/webhook (mock mode)
{ "type": "checkout.session.completed", "data": { "object": { ... } } }
```

## Testing

```bash
# Unit tests (82 tests)
npm run test

# Test coverage (93%+ statement coverage)
npm run test:cov

# E2E tests (34 tests — requires .env configuration)
npm run test:e2e
```

### Test Coverage Summary

| Module | Statements |
|--------|:----------:|
| `stripe/stripe.service` | 100% |
| `stripe/webhook/*` | 100% |
| `subscription/*` | 100% |
| `auth/auth.service` | 100% |
| `auth/auth.controller` | 100% |
| **Overall** | **93.4%** |

## Deployment

### Docker

```bash
# Start all services (app + PostgreSQL + Redis)
docker-compose up -d

# Or build and run only the app (requires external database)
docker build -t nestjs-saas-kit .
docker run -p 3000:3000 --env-file .env nestjs-saas-kit
```

### Railway

1. Push the repository to GitHub
2. Connect the repo on [Railway](https://railway.app/)
3. Add a PostgreSQL plugin — Railway provides `DATABASE_URL` automatically
4. Set the remaining environment variables in the dashboard
5. Add a `postbuild` script: `"postbuild": "npx prisma generate && npx prisma db push"`
6. Deploy — Railway auto-detects the Dockerfile or Node.js build

> For production, always configure `STRIPE_WEBHOOK_SECRET` and use Stripe CLI or a dashboard webhook endpoint to forward real events.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start with watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run compiled build |
| `npm run test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run lint` | Lint and fix |

## License

MIT — feel free to use this project for any purpose.
