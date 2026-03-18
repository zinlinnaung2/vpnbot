import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SettingsService implements OnModuleInit {
  private blocked2DNumbers: string[] = [];

  // New cached fields
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

    // Parse Blocked Numbers
    const blocked = settings.find((s) => s.key === 'BLOCKED_2D_NUMBERS');
    this.blocked2DNumbers = blocked ? JSON.parse(blocked.value) : [];

    // Parse Open/Close Status
    const openStatus = settings.find((s) => s.key === 'GAME_PURCHASE_OPEN');
    this.isGamePurchaseOpen = openStatus ? openStatus.value === 'true' : true;

    // Parse Reason
    const reason = settings.find((s) => s.key === 'GAME_PURCHASE_CLOSE_REASON');
    this.gamePurchaseCloseReason = reason ? reason.value : '';

    console.log(`[Cache Loaded] Purchase Open: ${this.isGamePurchaseOpen}`);
  }

  // --- Getters (Fast Memory Reads) ---

  getBlockedNumbers(): string[] {
    return this.blocked2DNumbers;
  }

  getPurchaseStatus() {
    return {
      isOpen: this.isGamePurchaseOpen,
      reason: this.gamePurchaseCloseReason,
    };
  }

  // --- Updaters (DB + Memory Sync) ---

  async updateGamePurchaseStatus(isOpen: boolean, reason?: string) {
    await this.prisma.$transaction([
      this.prisma.systemSetting.upsert({
        where: { key: 'GAME_PURCHASE_OPEN' },
        update: { value: isOpen ? 'true' : 'false' },
        create: { key: 'GAME_PURCHASE_OPEN', value: isOpen ? 'true' : 'false' },
      }),
      this.prisma.systemSetting.upsert({
        where: { key: 'GAME_PURCHASE_CLOSE_REASON' },
        update: { value: reason || '' },
        create: { key: 'GAME_PURCHASE_CLOSE_REASON', value: reason || '' },
      }),
    ]);

    // Update Cache
    this.isGamePurchaseOpen = isOpen;
    this.gamePurchaseCloseReason = reason || '';

    return { isOpen, reason };
  }

  // Your existing update method
  async updateBlockedNumbers(numbers: string[]) {
    await this.prisma.systemSetting.upsert({
      where: { key: 'BLOCKED_2D_NUMBERS' },
      update: { value: JSON.stringify(numbers) },
      create: { key: 'BLOCKED_2D_NUMBERS', value: JSON.stringify(numbers) },
    });
    this.blocked2DNumbers = numbers;
    return this.blocked2DNumbers;
  }
}
