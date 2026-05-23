import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { STRIPE_CLIENT } from './../src/stripe/stripe.constants';

describe('Stripe + Subscription (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let accessToken: string;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    subscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockStripeClient = {
    customers: { create: jest.fn(), retrieve: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    subscriptions: { retrieve: jest.fn(), update: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  };

  const mockUser = {
    id: 'user-test-1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'USER',
    isActive: true,
    stripeCustomerId: 'cus_test_123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSubscription = {
    id: 'sub-db-1',
    userId: 'user-test-1',
    stripeId: 'sub_stripe_1',
    status: 'active',
    priceId: 'price_123',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(STRIPE_CLIENT)
      .useValue(mockStripeClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    accessToken = jwtService.sign({
      sub: 'user-test-1',
      email: 'test@example.com',
      role: 'USER',
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // POST /subscriptions — create checkout session
  // -----------------------------------------------------------------------
  describe('POST /subscriptions', () => {
    it('should create a checkout session and return URL', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockStripeClient.customers.create.mockResolvedValue({ id: 'cus_test_123' });
      mockStripeClient.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/session',
      });

      const res = await request(app.getHttpServer())
        .post('/subscriptions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ priceId: 'price_test_1' })
        .expect(201);

      expect(res.body).toHaveProperty('url', 'https://checkout.stripe.com/session');
      expect(res.body).toHaveProperty('sessionId', 'cs_test_123');
    });

    it('should return 401 without JWT', async () => {
      await request(app.getHttpServer())
        .post('/subscriptions')
        .send({ priceId: 'price_test_1' })
        .expect(401);
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/subscriptions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ priceId: 'price_test_1' })
        .expect(404);
    });
  });

  // -----------------------------------------------------------------------
  // GET /subscriptions/current — get current subscription
  // -----------------------------------------------------------------------
  describe('GET /subscriptions/current', () => {
    it('should return the current subscription', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(mockSubscription);

      const res = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', 'sub-db-1');
      expect(res.body).toHaveProperty('status', 'active');
    });

    it('should return null when no subscription', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/subscriptions/current')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toEqual({});
    });

    it('should return 401 without JWT', async () => {
      await request(app.getHttpServer())
        .get('/subscriptions/current')
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /subscriptions — cancel subscription at period end
  // -----------------------------------------------------------------------
  describe('DELETE /subscriptions', () => {
    it('should cancel subscription at period end', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(mockSubscription);
      mockStripeClient.subscriptions.update.mockResolvedValue({});
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSubscription,
        cancelAtPeriodEnd: true,
      });

      const res = await request(app.getHttpServer())
        .delete('/subscriptions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('cancelAtPeriodEnd', true);
    });

    it('should return 404 when no active subscription', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .delete('/subscriptions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /subscriptions/plan — change subscription plan
  // -----------------------------------------------------------------------
  describe('PATCH /subscriptions/plan', () => {
    it('should change the subscription price plan', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(mockSubscription);
      mockStripeClient.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_stripe_1',
        items: { data: [{ id: 'si_1' }] },
      });
      mockStripeClient.subscriptions.update.mockResolvedValue({});
      mockPrisma.subscription.update.mockResolvedValue({
        ...mockSubscription,
        priceId: 'price_new_1',
      });

      const res = await request(app.getHttpServer())
        .patch('/subscriptions/plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ priceId: 'price_new_1' })
        .expect(200);

      expect(res.body).toHaveProperty('priceId', 'price_new_1');
    });

    it('should return 404 when no active subscription', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .patch('/subscriptions/plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ priceId: 'price_new_1' })
        .expect(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST /stripe/webhook — handle Stripe events (mock mode)
  // -----------------------------------------------------------------------
  describe('POST /stripe/webhook (mock mode)', () => {
    it('should handle checkout.session.completed', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockStripeClient.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_stripe_1',
        status: 'active',
        items: { data: [{ price: { id: 'price_123' } }] },
        current_period_start: 1700000000,
        current_period_end: 1702592000,
        cancel_at_period_end: false,
      });
      mockPrisma.subscription.upsert.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/stripe/webhook')
        .send({
          type: 'checkout.session.completed',
          data: {
            object: {
              customer: 'cus_test_123',
              subscription: 'sub_stripe_1',
            },
          },
        })
        .expect(200);

      expect(res.body).toEqual({ received: true });
    });

    it('should handle customer.subscription.updated', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.subscription.upsert.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/stripe/webhook')
        .send({
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_stripe_1',
              customer: 'cus_test_123',
              status: 'active',
              items: { data: [{ price: { id: 'price_123' } }] },
              current_period_start: 1700000000,
              current_period_end: 1702592000,
              cancel_at_period_end: false,
            },
          },
        })
        .expect(200);

      expect(res.body).toEqual({ received: true });
    });

    it('should handle customer.subscription.deleted', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.subscription.update.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/stripe/webhook')
        .send({
          type: 'customer.subscription.deleted',
          data: {
            object: {
              id: 'sub_stripe_1',
              customer: 'cus_test_123',
            },
          },
        })
        .expect(200);

      expect(res.body).toEqual({ received: true });
    });

    it('should handle invoice.payment_failed', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-db-1',
        stripeId: 'sub_stripe_1',
      });
      mockPrisma.subscription.update.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/stripe/webhook')
        .send({
          type: 'invoice.payment_failed',
          data: {
            object: {
              subscription: 'sub_stripe_1',
            },
          },
        })
        .expect(200);

      expect(res.body).toEqual({ received: true });
    });

    it('should return 200 for unknown event types (noop)', async () => {
      const res = await request(app.getHttpServer())
        .post('/stripe/webhook')
        .send({
          type: 'unknown.event',
          data: { object: {} },
        })
        .expect(200);

      expect(res.body).toEqual({ received: true });
    });
  });
});
