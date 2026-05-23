import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let subscriptionService: jest.Mocked<SubscriptionService>;

  const mockUser = { sub: 'user_1', email: 'test@example.com', role: 'USER' };

  beforeEach(async () => {
    subscriptionService = {
      create: jest.fn(),
      getCurrent: jest.fn(),
      cancel: jest.fn(),
      changePlan: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        { provide: SubscriptionService, useValue: subscriptionService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<SubscriptionController>(SubscriptionController);
  });

  describe('create', () => {
    it('should call service.create with priceId and user sub', async () => {
      const result = { url: 'https://checkout.stripe.com/session', sessionId: 'cs_123' };
      subscriptionService.create.mockResolvedValue(result);

      const res = await controller.create({ priceId: 'price_123' }, mockUser);

      expect(subscriptionService.create).toHaveBeenCalledWith('price_123', 'user_1');
      expect(res).toEqual(result);
    });
  });

  describe('getCurrent', () => {
    it('should call service.getCurrent with user sub', async () => {
      const sub = { id: 'sub_1', status: 'active' };
      subscriptionService.getCurrent.mockResolvedValue(sub as any);

      const res = await controller.getCurrent(mockUser);

      expect(subscriptionService.getCurrent).toHaveBeenCalledWith('user_1');
      expect(res).toEqual(sub);
    });
  });

  describe('cancel', () => {
    it('should call service.cancel with user sub', async () => {
      const result = { id: 'sub_1', cancelAtPeriodEnd: true };
      subscriptionService.cancel.mockResolvedValue(result as any);

      const res = await controller.cancel(mockUser);

      expect(subscriptionService.cancel).toHaveBeenCalledWith('user_1');
      expect(res).toEqual(result);
    });
  });

  describe('changePlan', () => {
    it('should call service.changePlan with priceId and user sub', async () => {
      const result = { id: 'sub_1', priceId: 'price_456' };
      subscriptionService.changePlan.mockResolvedValue(result as any);

      const res = await controller.changePlan({ priceId: 'price_456' }, mockUser);

      expect(subscriptionService.changePlan).toHaveBeenCalledWith('price_456', 'user_1');
      expect(res).toEqual(result);
    });
  });
});
