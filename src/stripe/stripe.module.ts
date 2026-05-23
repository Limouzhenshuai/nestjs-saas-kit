import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from './stripe.constants';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './webhook/stripe-webhook.controller';
import { StripeWebhookService } from './webhook/stripe-webhook.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [StripeWebhookController],
  providers: [
    {
      provide: STRIPE_CLIENT,
      useFactory: (configService: ConfigService) => {
        const key = configService.get<string>('STRIPE_SECRET_KEY');
        if (!key) {
          throw new Error('STRIPE_SECRET_KEY environment variable is required');
        }
        return new Stripe(key);
      },
      inject: [ConfigService],
    },
    StripeService,
    StripeWebhookService,
  ],
  exports: [StripeService],
})
export class StripeModule {}
