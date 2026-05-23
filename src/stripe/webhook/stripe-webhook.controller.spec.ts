import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeService } from '../stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;
  let stripeService: jest.Mocked<StripeService>;
  let stripeWebhookService: jest.Mocked<StripeWebhookService>;

  function createMockReq(rawBody?: Buffer) {
    return {
      rawBody,
      body: {},
      headers: {},
    } as any;
  }

  beforeEach(async () => {
    stripeService = {
      constructWebhookEvent: jest.fn(),
    } as any;
    stripeWebhookService = {
      handleEvent: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        { provide: StripeService, useValue: stripeService },
        { provide: StripeWebhookService, useValue: stripeWebhookService },
      ],
    }).compile();

    controller = module.get<StripeWebhookController>(StripeWebhookController);
  });

  describe('handleWebhook', () => {
    beforeEach(() => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    });

    it('should use mock mode when no webhook secret is configured', async () => {
      const req = createMockReq();
      const body = {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_123' } },
      };

      await controller.handleWebhook(req, body, '');

      expect(stripeService.constructWebhookEvent).not.toHaveBeenCalled();
      expect(stripeWebhookService.handleEvent).toHaveBeenCalledWith(
        'checkout.session.completed',
        { id: 'cs_123' },
      );
    });

    it('should verify signature when webhook secret and signature are present', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const rawBody = Buffer.from(JSON.stringify({ test: true }));
      const req = createMockReq(rawBody);
      const body = { type: 'event', data: { object: {} } };

      stripeService.constructWebhookEvent.mockReturnValue({
        type: 'verified.event',
        data: { object: { verified: true } },
      } as any);

      await controller.handleWebhook(req, body, 'test_sig');

      expect(stripeService.constructWebhookEvent).toHaveBeenCalledWith(
        rawBody,
        'test_sig',
      );
      expect(stripeWebhookService.handleEvent).toHaveBeenCalledWith(
        'verified.event',
        { verified: true },
      );
    });

    it('should fall back to JSON.stringify body when rawBody is not available', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const req = createMockReq(undefined);
      const body = { type: 'event', data: { object: {} } };

      stripeService.constructWebhookEvent.mockReturnValue({
        type: 'verified.event',
        data: { object: {} },
      } as any);

      await controller.handleWebhook(req, body, 'test_sig');

      expect(stripeService.constructWebhookEvent).toHaveBeenCalledWith(
        JSON.stringify(body),
        'test_sig',
      );
    });

    it('should throw BadRequestException when signature verification fails', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const req = createMockReq(Buffer.from('{}'));

      stripeService.constructWebhookEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(
        controller.handleWebhook(req, {}, 'bad_sig'),
      ).rejects.toThrow(BadRequestException);

      expect(stripeWebhookService.handleEvent).not.toHaveBeenCalled();
    });
  });
});
