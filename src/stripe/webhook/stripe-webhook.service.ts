import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe.service';

@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  async handleEvent(type: string, data: any) {
    switch (type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(data);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(data);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(data);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(data);
        break;
      default:
        break;
    }
  }

  private async handleCheckoutCompleted(session: any) {
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;
    if (!subscriptionId) return;

    const user = await this.prisma.user.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!user) return;

    const stripeSubscription =
      await this.stripeService.retrieveSubscription(subscriptionId);
    const data = this.stripeService.extractSubscriptionData(
      stripeSubscription as any,
    );

    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
  }

  private async handleSubscriptionUpdated(subscription: any) {
    const user = await this.prisma.user.findFirst({
      where: { stripeCustomerId: subscription.customer as string },
    });
    if (!user) return;

    const data = this.stripeService.extractSubscriptionData(subscription);

    await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
  }

  private async handleSubscriptionDeleted(subscription: any) {
    const user = await this.prisma.user.findFirst({
      where: { stripeCustomerId: subscription.customer as string },
    });
    if (!user) return;

    await this.prisma.subscription.update({
      where: { userId: user.id },
      data: { status: 'canceled' },
    });
  }

  private async handlePaymentFailed(invoice: any) {
    const subscriptionId = invoice.subscription as string;
    if (!subscriptionId) return;

    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeId: subscriptionId },
    });
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'past_due' },
    });
  }
}
