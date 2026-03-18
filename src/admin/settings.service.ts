// src/admin/settings.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SettingsService implements OnModuleInit {
  private blocked2DNumbers: string[] = [];
  private isGamePurchaseOpen: boolean = true;
  private gamePurchaseCloseReason: string = '';

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  private async refreshCache() {
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'BLOCKED_2D_NUMBERS',
            'GAME_PURCHASE_OPEN',
            'GAME_PURCHASE_CLOSE_REASON',
          ],
        },
      },
    });

    const blocked = settings.find((s) => s.key === 'BLOCKED_2D_NUMBERS');
    this.blocked2DNumbers = blocked ? JSON.parse(blocked.value) : [];

    const openStatus = settings.find((s) => s.key === 'GAME_PURCHASE_OPEN');
    // Ensure we handle the "true"/"false" string properly
    this.isGamePurchaseOpen = openStatus ? openStatus.value === 'true' : true;

    const reason = settings.find((s) => s.key === 'GAME_PURCHASE_CLOSE_REASON');
    this.gamePurchaseCloseReason = reason ? reason.value : '';

    console.log(`[Cache Sync] Shop Open: ${this.isGamePurchaseOpen}`);
  }

  getPurchaseStatus() {
    return {
      isOpen: this.isGamePurchaseOpen,
      reason: this.gamePurchaseCloseReason,
    };
  }

  async updateGamePurchaseStatus(isOpen: any, reason?: string) {
    // CRITICAL FIX: Ensure isOpen is a proper boolean even if it comes as a string or number
    const status = isOpen === true || String(isOpen) === 'true';

    await this.prisma.$transaction([
      this.prisma.systemSetting.upsert({
        where: { key: 'GAME_PURCHASE_OPEN' },
        update: { value: status ? 'true' : 'false' },
        create: { key: 'GAME_PURCHASE_OPEN', value: status ? 'true' : 'false' },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: 'GAME_PURCHASE_CLOSE_REASON' },
        update: { value: reason || '' },
        create: { key: 'GAME_PURCHASE_CLOSE_REASON', value: reason || '' },
      }),
    ]);

    // Update Memory immediately
    this.isGamePurchaseOpen = status;
    this.gamePurchaseCloseReason = reason || '';

    return {
      isOpen: this.isGamePurchaseOpen,
      reason: this.gamePurchaseCloseReason,
    };
  }

  async updateBlockedNumbers(numbers: string[]) {
    await this.prisma.systemSetting.upsert({
      where: { key: 'BLOCKED_2D_NUMBERS' },
      update: { value: JSON.stringify(numbers) },
      create: { key: 'BLOCKED_2D_NUMBERS', value: JSON.stringify(numbers) },
    });
    this.blocked2DNumbers = numbers;
    return this.blocked2DNumbers;
  }

  getBlockedNumbers(): string[] {
    return this.blocked2DNumbers;
  }
}
