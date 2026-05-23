import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STRIPE_CLIENT } from './stripe.constants';
import { PrismaService } from '../prisma/prisma.service';

type StripeClient = any;
type StripeSubscription = any;

@Injectable()
export class StripeService {
  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: StripeClient,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async createCustomer(email: string, name?: string) {
    return this.stripe.customers.create({ email, name });
  }

  async getCustomer(stripeCustomerId: string) {
    return this.stripe.customers.retrieve(stripeCustomerId);
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ) {
    return this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  }

  async retrieveSubscription(stripeSubscriptionId: string) {
    return this.stripe.subscriptions.retrieve(stripeSubscriptionId);
  }

  async cancelAtPeriodEnd(stripeSubscriptionId: string) {
    return this.stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  async reActivateSubscription(stripeSubscriptionId: string) {
    return this.stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
  }

  async updateSubscriptionPrice(
    stripeSubscriptionId: string,
    newPriceId: string,
  ) {
    const subscription =
      await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) {
      throw new Error('No subscription items found');
    }
    return this.stripe.subscriptions.update(stripeSubscriptionId, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: 'create_prorations',
    });
  }

  constructWebhookEvent(payload: Buffer | string, signature: string) {
    const secret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }

  async ensureCustomer(
    userId: string,
    email: string,
    name?: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.stripeCustomerId) {
      return user.stripeCustomerId;
    }
    const customer = await this.createCustomer(email, name);
    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }

  extractSubscriptionData(subscription: StripeSubscription) {
    return {
      stripeId: subscription.id,
      status: subscription.status,
      priceId: subscription.items.data[0]?.price.id ?? '',
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };
  }
}
