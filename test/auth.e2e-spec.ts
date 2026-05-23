import {
  Controller,
  Get,
  INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { execSync } from 'child_process';
import { join } from 'path';
import { rmSync } from 'fs';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { Roles } from '../src/auth/decorators/roles.decorator';

// ---------------------------------------------------------------------------
// Test controller for RBAC verification
// ---------------------------------------------------------------------------
@Controller('test-rbac')
class TestRbacController {
  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  getAdminData() {
    return { message: 'admin only' };
  }

  @Get('user')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('USER')
  getUserData() {
    return { message: 'user only' };
  }
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const DB_PATH = join(__dirname, '..', 'prisma', 'test.db');

  const testUser = {
    email: 'alice@example.com',
    password: 'StrongPass1',
    name: 'Alice',
  };

  beforeAll(async () => {
    // Override env vars for test database
    process.env.DATABASE_URL = `file:${DB_PATH}`;
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRATION = '15m';

    // Push schema to SQLite test database
    execSync(
      'npx prisma db push --schema=prisma/schema.test.prisma --accept-data-loss',
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        stdio: 'pipe',
      },
    );

    // Build the NestJS test module, overriding PrismaService with a SQLite client

    const {
      PrismaClient: SqlitePrismaClient,
    } = require('../node_modules/.prisma/test-client');
    const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
    const adapter = new PrismaBetterSqlite3({ url: `file:${DB_PATH}` });
    const sqlitePrisma = new SqlitePrismaClient({ adapter });
    await sqlitePrisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: '.env.test',
          isGlobal: true,
        }),
        PrismaModule,
        AuthModule,
      ],
      controllers: [TestRbacController],
    })
      .overrideProvider(PrismaService)
      .useValue(sqlitePrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    try {
      rmSync(DB_PATH);
      rmSync(DB_PATH + '-journal');
    } catch {
      // ignore cleanup errors
    }
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  // -----------------------------------------------------------------------
  // POST /auth/register
  // -----------------------------------------------------------------------
  describe('POST /auth/register', () => {
    it('should register a new user and return 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe(testUser.email);
      expect(res.body.name).toBe(testUser.name);
      expect(res.body.role).toBe('USER');
      expect(res.body.isActive).toBe(true);
      // Sensitive fields must not leak
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('refreshTokenHash');
    });

    it('should reject registration with duplicate email and return 409', async () => {
      // Pre‑seed the user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(409);
    });

    it('should reject password shorter than 8 characters', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'short@example.com', password: '12' })
        .expect(400);
    });

    it('should reject invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'LongEnough1' })
        .expect(400);
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/login
  // -----------------------------------------------------------------------
  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);
    });

    it('should login with valid credentials and return token pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(typeof res.body.access_token).toBe('string');
      expect(typeof res.body.refresh_token).toBe('string');
    });

    it('should reject wrong password with 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'WrongPass1' })
        .expect(401);
    });

    it('should reject non‑existent email with 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ghost@example.com', password: 'AnyPass1' })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // JWT‑protected endpoints
  // -----------------------------------------------------------------------
  describe('JWT-protected endpoints', () => {
    let validToken: string;

    beforeEach(async () => {
      // Register & login
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      validToken = loginRes.body.access_token;
    });

    it('should allow access with valid token (200)', async () => {
      // Use the test‑rbac/user endpoint which requires role USER
      const res = await request(app.getHttpServer())
        .get('/test-rbac/user')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(res.body.message).toBe('user only');
    });

    it('should reject access without token (401)', async () => {
      await request(app.getHttpServer()).get('/test-rbac/user').expect(401);
    });

    it('should reject access with malformed token (401)', async () => {
      await request(app.getHttpServer())
        .get('/test-rbac/user')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should reject access with a tampered token (401)', async () => {
      // JWT with a different signature
      await request(app.getHttpServer())
        .get('/test-rbac/user')
        .set(
          'Authorization',
          'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.tampered',
        )
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/refresh
  // -----------------------------------------------------------------------
  describe('POST /auth/refresh', () => {
    let currentRefreshToken: string;

    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      currentRefreshToken = loginRes.body.refresh_token;
    });

    it('should return a new token pair (200)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: currentRefreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(res.body.access_token).not.toBe(currentRefreshToken);
    });

    it('should reject an invalid refresh token (401)', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: 'some-random-string' })
        .expect(401);
    });

    it('should reject a used refresh token after rotation (401)', async () => {
      const oldToken = currentRefreshToken;

      // First refresh – succeeds
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: oldToken })
        .expect(200);

      // Second refresh with the same token – must fail because the hash was rotated
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: oldToken })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/logout → refresh flow
  // -----------------------------------------------------------------------
  describe('logout + refresh', () => {
    it('should reject refresh token after logout (401)', async () => {
      // Register & login
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      const { access_token, refresh_token } = loginRes.body;

      // Logout
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(204);

      // Try to refresh – should fail because refreshTokenHash was cleared
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // RBAC – Role‑based access control
  // -----------------------------------------------------------------------
  describe('RBAC', () => {
    async function createUserAndLogin(roleOverride?: string) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);

      if (roleOverride) {
        await prisma.user.update({
          where: { email: testUser.email },
          data: { role: roleOverride as any },
        });
      }

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      return loginRes.body.access_token;
    }

    it('should forbid USER from ADMIN endpoint (403)', async () => {
      const token = await createUserAndLogin(); // role stays USER
      await request(app.getHttpServer())
        .get('/test-rbac/admin')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('should allow ADMIN to access ADMIN endpoint (200)', async () => {
      const token = await createUserAndLogin('ADMIN');
      await request(app.getHttpServer())
        .get('/test-rbac/admin')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.message).toBe('admin only');
        });
    });

    it('should allow USER to access USER endpoint (200)', async () => {
      const token = await createUserAndLogin(); // role stays USER
      await request(app.getHttpServer())
        .get('/test-rbac/user')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.message).toBe('user only');
        });
    });
  });
});
