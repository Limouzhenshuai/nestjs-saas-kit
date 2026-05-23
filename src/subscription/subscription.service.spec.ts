import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

function createMockPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
    },
    subscription: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

function createMockStripeService() {
  return {
    ensureCustomer: jest.fn(),
    createCheckoutSession: jest.fn(),
    cancelAtPeriodEnd: jest.fn(),
    updateSubscriptionPrice: jest.fn(),
  };
}

const mockUser = {
  id: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
};
const mockSubscription = {
  id: 'sub_db_1',
  userId: 'user_1',
  stripeId: 'sub_stripe_1',
  status: 'active',
  priceId: 'price_123',
};

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let stripeService: ReturnType<typeof createMockStripeService>;

  beforeEach(async () => {
    const mockPrisma = createMockPrisma();
    const mockStripe = createMockStripeService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StripeService, useValue: mockStripe },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    prisma = mockPrisma;
    stripeService = mockStripe;

    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('should create a checkout session and return URL', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      stripeService.ensureCustomer.mockResolvedValue('cus_123');
      stripeService.createCheckoutSession.mockResolvedValue({
        id: 'cs_123',
        url: 'https://checkout.stripe.com/session',
      });

      const result = await service.create('price_123', 'user_1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user_1' },
      });
      expect(stripeService.ensureCustomer).toHaveBeenCalledWith(
        'user_1',
        'test@example.com',
        'Test User',
      );
      expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
        'cus_123',
        'price_123',
        'http://localhost:3000/subscriptions/success',
        'http://localhost:3000/subscriptions/cancel',
      );
      expect(result).toEqual({
        url: 'https://checkout.stripe.com/session',
        sessionId: 'cs_123',
      });
    });

    it('should use CLIENT_URL from env when available', async () => {
      process.env.CLIENT_URL = 'https://myapp.com';
      prisma.user.findUnique.mockResolvedValue(mockUser);
      stripeService.ensureCustomer.mockResolvedValue('cus_123');
      stripeService.createCheckoutSession.mockResolvedValue({
        id: 'cs_123',
        url: 'https://checkout.stripe.com/session',
      });

      await service.create('price_123', 'user_1');

      expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
        'cus_123',
        'price_123',
        'https://myapp.com/subscriptions/success',
        'https://myapp.com/subscriptions/cancel',
      );
      delete process.env.CLIENT_URL;
    });

    it('should throw NotFoundException when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.create('price_123', 'user_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(stripeService.ensureCustomer).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getCurrent
  // -----------------------------------------------------------------------
  describe('getCurrent', () => {
    it('should return the current subscription for the user', async () => {
      prisma.subscription.findUnique.mockResolvedValue(mockSubscription);

      const result = await service.getCurrent('user_1');

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
      });
      expect(result).toEqual(mockSubscription);
    });

    it('should return null when user has no subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      const result = await service.getCurrent('user_1');

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // cancel
  // -----------------------------------------------------------------------
  describe('cancel', () => {
    it('should cancel subscription at period end', async () => {
      prisma.subscription.findUnique.mockResolvedValue(mockSubscription);
      stripeService.cancelAtPeriodEnd.mockResolvedValue({} as any);
      prisma.subscription.update.mockResolvedValue({
        ...mockSubscription,
        cancelAtPeriodEnd: true,
      });

      const result = await service.cancel('user_1');

      expect(stripeService.cancelAtPeriodEnd).toHaveBeenCalledWith(
        'sub_stripe_1',
      );
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        data: { cancelAtPeriodEnd: true },
      });
      expect(result.cancelAtPeriodEnd).toBe(true);
    });

    it('should throw NotFoundException when no active subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.cancel('user_1')).rejects.toThrow(NotFoundException);
      expect(stripeService.cancelAtPeriodEnd).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // changePlan
  // -----------------------------------------------------------------------
  describe('changePlan', () => {
    it('should change the subscription price plan', async () => {
      prisma.subscription.findUnique.mockResolvedValue(mockSubscription);
      stripeService.updateSubscriptionPrice.mockResolvedValue({} as any);
      prisma.subscription.update.mockResolvedValue({
        ...mockSubscription,
        priceId: 'price_456',
      });

      const result = await service.changePlan('price_456', 'user_1');

      expect(stripeService.updateSubscriptionPrice).toHaveBeenCalledWith(
        'sub_stripe_1',
        'price_456',
      );
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        data: { priceId: 'price_456' },
      });
      expect(result.priceId).toBe('price_456');
    });

    it('should throw NotFoundException when no active subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.changePlan('price_456', 'user_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(stripeService.updateSubscriptionPrice).not.toHaveBeenCalled();
    });
  });
});
