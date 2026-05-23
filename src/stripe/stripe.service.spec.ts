import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { STRIPE_CLIENT } from './stripe.constants';
import { PrismaService } from '../prisma/prisma.service';

function createMockStripeClient() {
  return {
    customers: { create: jest.fn(), retrieve: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    subscriptions: { retrieve: jest.fn(), update: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  };
}

function createMockPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    subscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
}

const mockSubscription = {
  id: 'sub_stripe_1',
  status: 'active',
  items: { data: [{ id: 'si_1', price: { id: 'price_123' } }] },
  current_period_start: 1700000000,
  current_period_end: 1702592000,
  cancel_at_period_end: false,
};

const mockCustomer = { id: 'cus_123' };
const mockSession = {
  id: 'cs_123',
  url: 'https://checkout.stripe.com/session',
};

describe('StripeService', () => {
  let service: StripeService;
  let stripeClient: ReturnType<typeof createMockStripeClient>;
  let prisma: ReturnType<typeof createMockPrisma>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockStripe = createMockStripeClient();
    const mockPrisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: STRIPE_CLIENT, useValue: mockStripe },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    stripeClient = mockStripe;
    prisma = mockPrisma;
    configService = module.get(ConfigService);

    jest.clearAllMocks();
  });

  describe('createCustomer', () => {
    it('should create a Stripe customer', async () => {
      stripeClient.customers.create.mockResolvedValue(mockCustomer);

      const result = await service.createCustomer('test@example.com', 'Test');

      expect(stripeClient.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test',
      });
      expect(result).toEqual(mockCustomer);
    });

    it('should create a Stripe customer without name', async () => {
      stripeClient.customers.create.mockResolvedValue(mockCustomer);

      const result = await service.createCustomer('test@example.com');

      expect(stripeClient.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: undefined,
      });
      expect(result).toEqual(mockCustomer);
    });
  });

  describe('getCustomer', () => {
    it('should retrieve a Stripe customer', async () => {
      stripeClient.customers.retrieve.mockResolvedValue(mockCustomer);

      const result = await service.getCustomer('cus_123');

      expect(stripeClient.customers.retrieve).toHaveBeenCalledWith('cus_123');
      expect(result).toEqual(mockCustomer);
    });
  });

  describe('createCheckoutSession', () => {
    it('should create a checkout session with correct parameters', async () => {
      stripeClient.checkout.sessions.create.mockResolvedValue(mockSession);

      const result = await service.createCheckoutSession(
        'cus_123',
        'price_123',
        'http://example.com/success',
        'http://example.com/cancel',
      );

      expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_123',
        mode: 'subscription',
        line_items: [{ price: 'price_123', quantity: 1 }],
        success_url: 'http://example.com/success',
        cancel_url: 'http://example.com/cancel',
      });
      expect(result).toEqual(mockSession);
    });
  });

  describe('retrieveSubscription', () => {
    it('should retrieve a Stripe subscription', async () => {
      stripeClient.subscriptions.retrieve.mockResolvedValue(mockSubscription);

      const result = await service.retrieveSubscription('sub_stripe_1');

      expect(stripeClient.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_stripe_1',
      );
      expect(result).toEqual(mockSubscription);
    });
  });

  describe('cancelAtPeriodEnd', () => {
    it('should set cancel_at_period_end to true', async () => {
      stripeClient.subscriptions.update.mockResolvedValue(mockSubscription);

      const result = await service.cancelAtPeriodEnd('sub_stripe_1');

      expect(stripeClient.subscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        {
          cancel_at_period_end: true,
        },
      );
      expect(result).toEqual(mockSubscription);
    });
  });

  describe('reActivateSubscription', () => {
    it('should set cancel_at_period_end to false', async () => {
      stripeClient.subscriptions.update.mockResolvedValue(mockSubscription);

      const result = await service.reActivateSubscription('sub_stripe_1');

      expect(stripeClient.subscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        {
          cancel_at_period_end: false,
        },
      );
      expect(result).toEqual(mockSubscription);
    });
  });

  describe('updateSubscriptionPrice', () => {
    it('should update the subscription price with prorations', async () => {
      stripeClient.subscriptions.retrieve.mockResolvedValue(mockSubscription);
      stripeClient.subscriptions.update.mockResolvedValue(mockSubscription);

      const result = await service.updateSubscriptionPrice(
        'sub_stripe_1',
        'price_456',
      );

      expect(stripeClient.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_stripe_1',
      );
      expect(stripeClient.subscriptions.update).toHaveBeenCalledWith(
        'sub_stripe_1',
        {
          items: [{ id: 'si_1', price: 'price_456' }],
          proration_behavior: 'create_prorations',
        },
      );
      expect(result).toEqual(mockSubscription);
    });

    it('should throw when subscription has no items', async () => {
      stripeClient.subscriptions.retrieve.mockResolvedValue({
        ...mockSubscription,
        items: { data: [] },
      });

      await expect(
        service.updateSubscriptionPrice('sub_stripe_1', 'price_456'),
      ).rejects.toThrow('No subscription items found');
    });
  });

  describe('constructWebhookEvent', () => {
    it('should construct and verify webhook event', () => {
      const mockEvent = { type: 'checkout.session.completed' };
      stripeClient.webhooks.constructEvent.mockReturnValue(mockEvent);
      configService.get.mockReturnValue('whsec_test');

      const result = service.constructWebhookEvent(
        Buffer.from('{}'),
        'test_sig',
      );

      expect(configService.get).toHaveBeenCalledWith('STRIPE_WEBHOOK_SECRET');
      expect(stripeClient.webhooks.constructEvent).toHaveBeenCalledWith(
        Buffer.from('{}'),
        'test_sig',
        'whsec_test',
      );
      expect(result).toEqual(mockEvent);
    });

    it('should throw when webhook secret is not configured', () => {
      configService.get.mockReturnValue(undefined);

      expect(() =>
        service.constructWebhookEvent(Buffer.from('{}'), 'test_sig'),
      ).toThrow('STRIPE_WEBHOOK_SECRET is not configured');
    });
  });

  describe('ensureCustomer', () => {
    it('should return existing stripeCustomerId if user already has one', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        stripeCustomerId: 'cus_existing',
      });

      const result = await service.ensureCustomer('user_1', 'test@example.com');

      expect(result).toBe('cus_existing');
      expect(stripeClient.customers.create).not.toHaveBeenCalled();
    });

    it('should create a new Stripe customer and save the ID', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        stripeCustomerId: null,
      });
      stripeClient.customers.create.mockResolvedValue(mockCustomer);
      prisma.user.update.mockResolvedValue({} as any);

      const result = await service.ensureCustomer(
        'user_1',
        'test@example.com',
        'Test',
      );

      expect(stripeClient.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test',
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: { stripeCustomerId: 'cus_123' },
      });
      expect(result).toBe('cus_123');
    });
  });

  describe('extractSubscriptionData', () => {
    it('should extract and transform subscription data', () => {
      const result = service.extractSubscriptionData(mockSubscription);

      expect(result).toEqual({
        stripeId: 'sub_stripe_1',
        status: 'active',
        priceId: 'price_123',
        currentPeriodStart: new Date(1700000000 * 1000),
        currentPeriodEnd: new Date(1702592000 * 1000),
        cancelAtPeriodEnd: false,
      });
    });

    it('should default priceId to empty string when no items', () => {
      const sub = { ...mockSubscription, items: { data: [] } };
      const result = service.extractSubscriptionData(sub);

      expect(result.priceId).toBe('');
    });
  });
});
