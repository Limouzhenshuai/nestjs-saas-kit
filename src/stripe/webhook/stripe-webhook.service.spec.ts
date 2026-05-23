import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookService } from './stripe-webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe.service';

function createMockPrisma() {
  return {
    user: { findFirst: jest.fn() },
    subscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
}

function createMockStripeService() {
  return {
    retrieveSubscription: jest.fn(),
    extractSubscriptionData: jest.fn(),
  };
}

const mockSubscriptionData = {
  stripeId: 'sub_stripe_1',
  status: 'active',
  priceId: 'price_123',
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(),
  cancelAtPeriodEnd: false,
};

describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let stripeService: ReturnType<typeof createMockStripeService>;

  beforeEach(async () => {
    const mockPrisma = createMockPrisma();
    const mockStripe = createMockStripeService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StripeService, useValue: mockStripe },
      ],
    }).compile();

    service = module.get<StripeWebhookService>(StripeWebhookService);
    prisma = mockPrisma;
    stripeService = mockStripe;

    jest.clearAllMocks();
  });

  describe('handleEvent', () => {
    it('should handle checkout.session.completed', async () => {
      const session = {
        customer: 'cus_123',
        subscription: 'sub_stripe_1',
      };
      prisma.user.findFirst.mockResolvedValue({ id: 'user_1' });
      stripeService.retrieveSubscription.mockResolvedValue({
        id: 'sub_stripe_1',
      });
      stripeService.extractSubscriptionData.mockReturnValue(
        mockSubscriptionData,
      );
      prisma.subscription.upsert.mockResolvedValue({} as any);

      await service.handleEvent('checkout.session.completed', session);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { stripeCustomerId: 'cus_123' },
      });
      expect(stripeService.retrieveSubscription).toHaveBeenCalledWith(
        'sub_stripe_1',
      );
      expect(prisma.subscription.upsert).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        create: { userId: 'user_1', ...mockSubscriptionData },
        update: mockSubscriptionData,
      });
    });

    it('should skip checkout.session.completed when no subscription ID', async () => {
      await service.handleEvent('checkout.session.completed', {
        customer: 'cus_123',
      });

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('should skip checkout.session.completed when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await service.handleEvent('checkout.session.completed', {
        customer: 'cus_unknown',
        subscription: 'sub_stripe_1',
      });

      expect(stripeService.retrieveSubscription).not.toHaveBeenCalled();
    });

    it('should handle customer.subscription.updated', async () => {
      const subscription = { id: 'sub_stripe_1', customer: 'cus_123' };
      prisma.user.findFirst.mockResolvedValue({ id: 'user_1' });
      stripeService.extractSubscriptionData.mockReturnValue(
        mockSubscriptionData,
      );
      prisma.subscription.upsert.mockResolvedValue({} as any);

      await service.handleEvent('customer.subscription.updated', subscription);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { stripeCustomerId: 'cus_123' },
      });
      expect(prisma.subscription.upsert).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        create: { userId: 'user_1', ...mockSubscriptionData },
        update: mockSubscriptionData,
      });
    });

    it('should skip customer.subscription.updated when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await service.handleEvent('customer.subscription.updated', {
        id: 'sub_stripe_1',
        customer: 'cus_unknown',
      });

      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('should handle customer.subscription.deleted', async () => {
      const subscription = { id: 'sub_stripe_1', customer: 'cus_123' };
      prisma.user.findFirst.mockResolvedValue({ id: 'user_1' });
      prisma.subscription.update.mockResolvedValue({} as any);

      await service.handleEvent('customer.subscription.deleted', subscription);

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        data: { status: 'canceled' },
      });
    });

    it('should skip customer.subscription.deleted when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await service.handleEvent('customer.subscription.deleted', {
        id: 'sub_stripe_1',
        customer: 'cus_unknown',
      });

      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('should handle invoice.payment_failed', async () => {
      const invoice = { subscription: 'sub_stripe_1' };
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub_db_1',
        stripeId: 'sub_stripe_1',
      });
      prisma.subscription.update.mockResolvedValue({} as any);

      await service.handleEvent('invoice.payment_failed', invoice);

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { stripeId: 'sub_stripe_1' },
      });
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub_db_1' },
        data: { status: 'past_due' },
      });
    });

    it('should skip invoice.payment_failed when no subscription ID', async () => {
      await service.handleEvent('invoice.payment_failed', {});

      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('should skip invoice.payment_failed when subscription not found in DB', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await service.handleEvent('invoice.payment_failed', {
        subscription: 'sub_unknown',
      });

      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('should do nothing for unknown event types', async () => {
      await service.handleEvent('unknown.event', {});

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });
});
