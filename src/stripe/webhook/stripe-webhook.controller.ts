import {
  Controller,
  Post,
  Headers,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { StripeService } from '../stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('stripe')
export class StripeWebhookController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly stripeWebhookService: StripeWebhookService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request,
    @Body() body: any,
    @Headers('stripe-signature') signature: string,
  ) {
    let event: { type: string; data: { object: any } };

    if (signature && process.env.STRIPE_WEBHOOK_SECRET) {
      try {
        const rawBody = (req as any).rawBody ?? JSON.stringify(body);
        event = this.stripeService.constructWebhookEvent(
          rawBody,
          signature,
        ) as any;
      } catch {
        throw new BadRequestException('Invalid webhook signature');
      }
    } else {
      // Mock mode: accept parsed JSON body for local development
      event = body;
    }

    await this.stripeWebhookService.handleEvent(event.type, event.data.object);
    return { received: true };
  }
}
