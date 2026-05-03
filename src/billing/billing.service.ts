import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant/tenant-connection.service';
import { Invoice } from '../database/tenant/entities/invoice.entity';
import { Subscription } from '../database/tenant/entities/subscription.entity';
import type { AuthUser } from '../common/types/request.types';

const PLAN_CATALOG = {
  starter: { name: 'Starter', amountIdr: 0, limits: { channels: 1, seats: 1 } },
  basic: {
    name: 'Basic',
    amountIdr: 149000,
    limits: { channels: 2, seats: 3 },
  },
  pro: { name: 'Pro', amountIdr: 499000, limits: { channels: 10, seats: 20 } },
} as const;

type PlanCode = keyof typeof PLAN_CATALOG;

@Injectable()
export class BillingService {
  constructor(private readonly tenantConn: TenantConnectionService) {}

  private async repos(tenantId: string) {
    const ds = await this.tenantConn.getDataSourceForTenant(tenantId);
    return {
      subRepo: ds.getRepository(Subscription),
      invoiceRepo: ds.getRepository(Invoice),
    };
  }

  private async ensureSubscription(tenantId: string) {
    const { subRepo } = await this.repos(tenantId);
    const existing = await subRepo.findOne({ order: { createdAt: 'DESC' } });
    if (existing) return existing;

    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const created = subRepo.create({
      planCode: 'starter',
      planName: PLAN_CATALOG.starter.name,
      isTrial: true,
      trialEndsAt,
      status: 'active',
      provider: null,
      providerRef: null,
    });
    return subRepo.save(created);
  }

  async overview(user: AuthUser) {
    const { invoiceRepo } = await this.repos(user.tenantId);
    const subscription = await this.ensureSubscription(user.tenantId);
    const latestInvoices = await invoiceRepo.find({
      order: { issuedAt: 'DESC' },
      take: 20,
    });
    const catalog = Object.entries(PLAN_CATALOG).map(([code, plan]) => ({
      code,
      name: plan.name,
      amountIdr: plan.amountIdr,
      limits: plan.limits,
    }));
    return {
      subscription,
      plans: catalog,
      invoices: latestInvoices,
    };
  }

  async selectPlan(user: AuthUser, planCode: PlanCode, provider?: 'midtrans' | 'xendit') {
    const { subRepo, invoiceRepo } = await this.repos(user.tenantId);
    const subscription = await this.ensureSubscription(user.tenantId);
    const plan = PLAN_CATALOG[planCode];
    if (!plan) {
      throw new BadRequestException('Plan tidak valid');
    }

    subscription.planCode = planCode;
    subscription.planName = plan.name;
    subscription.isTrial = false;
    subscription.trialEndsAt = null;
    subscription.provider = provider ?? null;
    subscription.providerRef = provider
      ? `${provider}_${Date.now().toString(36)}`
      : null;
    await subRepo.save(subscription);

    if (plan.amountIdr > 0) {
      const invoice = invoiceRepo.create({
        invoiceNo: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase()}`,
        planCode,
        planName: plan.name,
        amountIdr: plan.amountIdr,
        status: 'issued',
        issuedAt: new Date(),
        paidAt: null,
      });
      await invoiceRepo.save(invoice);
    }

    return subscription;
  }

  async listInvoices(user: AuthUser) {
    const { invoiceRepo } = await this.repos(user.tenantId);
    return invoiceRepo.find({ order: { issuedAt: 'DESC' }, take: 100 });
  }
}
