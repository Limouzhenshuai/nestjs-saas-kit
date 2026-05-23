import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ChangePlanDto } from './dto/change-plan.dto';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.create(dto.priceId, user.sub);
  }

  @Get('current')
  async getCurrent(@CurrentUser() user: any) {
    return this.subscriptionService.getCurrent(user.sub);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() user: any) {
    return this.subscriptionService.cancel(user.sub);
  }

  @Patch('plan')
  async changePlan(
    @Body() dto: ChangePlanDto,
    @CurrentUser() user: any,
  ) {
    return this.subscriptionService.changePlan(dto.priceId, user.sub);
  }
}
