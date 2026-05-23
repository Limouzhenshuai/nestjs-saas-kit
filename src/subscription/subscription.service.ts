import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  async create(priceId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const customerId = await this.stripeService.ensureCustomer(
      userId,
      user.email,
      user.name ?? undefined,
    );

    const session = await this.stripeService.createCheckoutSession(
      customerId,
      priceId,
      `${process.env.CLIENT_URL ?? 'http://localhost:3000'}/subscriptions/success`,
      `${process.env.CLIENT_URL ?? 'http://localhost:3000'}/subscriptions/cancel`,
    );

    return { url: session.url, sessionId: session.id };
  }

  async getCurrent(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    return subscription;
  }

  async cancel(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    if (!subscription) {
      throw new NotFoundException('No active subscription');
    }

    await this.stripeService.cancelAtPeriodEnd(subscription.stripeId);

    return this.prisma.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true },
    });
  }

  async changePlan(priceId: string, userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    if (!subscription) {
      throw new NotFoundException('No active subscription');
    }

    await this.stripeService.updateSubscriptionPrice(subscription.stripeId, priceId);

    return this.prisma.subscription.update({
      where: { userId },
      data: { priceId },
    });
  }
}
