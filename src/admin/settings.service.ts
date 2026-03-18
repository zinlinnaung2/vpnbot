import {
  Injectable,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class SettingsService implements OnModuleInit {
  // --- Memory Cache (For high-speed reads by the Bot) ---
  private blocked2DNumbers: string[] = [];
  private isGamePurchaseOpen: boolean = true;
  private gamePurchaseCloseReason: string = '';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Automatically runs when the server starts.
   * Loads settings from Database into Memory.
   */
  async onModuleInit() {
    await this.refreshCache();
  }

  /**
   * Pulls the latest data from the SystemSetting table.
   */
  private async refreshCache() {
    try {
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

      // 1. Handle Blocked Numbers
      const blocked = settings.find((s) => s.key === 'BLOCKED_2D_NUMBERS');
      this.blocked2DNumbers = blocked ? JSON.parse(blocked.value) : [];

      // 2. Handle Open/Close Status (Convert string 'true'/'false' to Boolean)
      const openStatus = settings.find((s) => s.key === 'GAME_PURCHASE_OPEN');
      this.isGamePurchaseOpen = openStatus ? openStatus.value === 'true' : true;

      // 3. Handle Reason
      const reason = settings.find(
        (s) => s.key === 'GAME_PURCHASE_CLOSE_REASON',
      );
      this.gamePurchaseCloseReason = reason ? reason.value : '';

      console.log(
        `[Settings Cache] Loaded. Shop Open: ${this.isGamePurchaseOpen}`,
      );
    } catch (error) {
      console.error('[Settings Cache] Failed to load settings:', error);
    }
  }

  // --- Getters (Called by the Bot / Controllers for fast access) ---

  getBlockedNumbers(): string[] {
    return this.blocked2DNumbers;
  }

  // src/admin/settings.service.ts

  async getPurchaseStatus() {
    // DB မှ တိုက်ရိုက်ဆွဲထုတ်ခြင်းက Cache sync error များကို ဖြေရှင်းပေးပါသည်
    const openStatus = await this.prisma.systemSetting.findUnique({
      where: { key: 'GAME_PURCHASE_OPEN' },
    });
    const reason = await this.prisma.systemSetting.findUnique({
      where: { key: 'GAME_PURCHASE_CLOSE_REASON' },
    });

    return {
      isOpen: openStatus ? openStatus.value === 'true' : true,
      reason: reason ? reason.value : '',
    };
  }

  // --- Updaters (DB Persistence + Memory Sync) ---

  /**
   * Updates the Shop Status.
   * Uses a Transaction to ensure both Reason and Status update together.
   */
  // src/admin/settings.service.ts

  async updateGamePurchaseStatus(isOpen: any, reason?: string) {
    // Convert any incoming type to a strict Boolean
    const status = isOpen === true || String(isOpen) === 'true';
    const finalReason = reason || '';

    try {
      // 1. Update Database
      await this.prisma.$transaction([
        this.prisma.systemSetting.upsert({
          where: { key: 'GAME_PURCHASE_OPEN' },
          update: { value: status ? 'true' : 'false' },
          create: {
            key: 'GAME_PURCHASE_OPEN',
            value: status ? 'true' : 'false',
          },
        }),
        this.prisma.systemSetting.upsert({
          where: { key: 'GAME_PURCHASE_CLOSE_REASON' },
          update: { value: finalReason },
          create: { key: 'GAME_PURCHASE_CLOSE_REASON', value: finalReason },
        }),
      ]);

      // 2. Update Local Memory Cache immediately
      this.isGamePurchaseOpen = status;
      this.gamePurchaseCloseReason = finalReason;

      console.log(`[Cache Updated] Open: ${status}, Reason: ${finalReason}`);

      // 3. Return the NEW state to the frontend
      return {
        isOpen: this.isGamePurchaseOpen,
        reason: this.gamePurchaseCloseReason,
      };
    } catch (error) {
      console.error('Update failed:', error);
      throw new InternalServerErrorException('Database update failed');
    }
  }

  /**
   * Updates the list of blocked 2D numbers.
   */
  async updateBlockedNumbers(numbers: string[]) {
    try {
      await this.prisma.systemSetting.upsert({
        where: { key: 'BLOCKED_2D_NUMBERS' },
        update: { value: JSON.stringify(numbers) },
        create: { key: 'BLOCKED_2D_NUMBERS', value: JSON.stringify(numbers) },
      });

      this.blocked2DNumbers = numbers;
      return this.blocked2DNumbers;
    } catch (error) {
      console.error('Failed to update blocked numbers:', error);
      throw new InternalServerErrorException(
        'Could not update blocked numbers.',
      );
    }
  }
}
