import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  BadRequestException,
  Body,
  Delete,
  Put,
  NotFoundException,
  Query,
  UseInterceptors,
  UploadedFile,
  InternalServerErrorException,
  Patch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { BotContext } from 'src/interfaces/bot-context.interface';
import { WithdrawService } from 'src/wallet/withdraw.service';
import { TransactionType, WithdrawStatus } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname } from 'path';
import { WalletService } from 'src/wallet/wallet.service';
import { CreateDepositDto } from './dto/deposit.dto';
import { SettingsService } from './settings.service';
import axios from 'axios';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectBot() private readonly bot: Telegraf<BotContext>,
    private readonly withdrawService: WithdrawService,
    private readonly walletService: WalletService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get('dashboard-stats')
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      userCount,
      pendingDeps,
      pendingWiths,
      pendingOrders,
      todayPurchases,
      todayWithdrawals,
      todayApprovedDeposits, // ထပ်တိုး- အတည်ပြုပြီးသား ငွေဖြည့်သွင်းမှုများ
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.deposit.findMany({
        where: { status: 'PENDING' },
        include: { user: true },
      }),
      this.prisma.withdraw.findMany({
        where: { status: 'PENDING' },
        include: { user: true },
      }),
      this.prisma.purchase.count({ where: { status: 'PENDING' } }),

      // ၁။ Product ဝယ်ယူမှုများ (အရောင်းရငွေ)
      this.prisma.purchase.aggregate({
        where: { createdAt: { gte: today } },
        _sum: { amount: true },
      }),

      // ၂။ ထုတ်ယူငွေ (APPROVED ဖြစ်ပြီးသား)
      this.prisma.withdraw.aggregate({
        where: { status: 'APPROVED', updatedAt: { gte: today } },
        _sum: { amount: true },
      }),

      // 💡 ၃။ ငွေဖြည့်သွင်းမှု (APPROVED ဖြစ်ပြီးသား) - ဤအချက်က Income ဖြစ်စေသည်
      this.prisma.deposit.aggregate({
        where: { status: 'APPROVED', updatedAt: { gte: today } },
        _sum: { amount: true },
      }),
    ]);

    // တွက်ချက်ခြင်း
    const purchaseRevenue = Number(todayPurchases._sum.amount || 0);
    const depositIncome = Number(todayApprovedDeposits._sum.amount || 0);
    const expense = Number(todayWithdrawals._sum.amount || 0);

    // 💡 စုစုပေါင်းဝင်ငွေ = အရောင်းရငွေ + ငွေဖြည့်သွင်းမှု
    const totalRevenue = purchaseRevenue + depositIncome;
    const netProfit = totalRevenue - expense;

    return {
      userCount,
      deposits: pendingDeps,
      withdrawals: pendingWiths,
      pendingOrdersCount: pendingOrders,
      todayRevenue: totalRevenue, // စုစုပေါင်းဝင်ငွေ
      todayPurchase: purchaseRevenue, // အရောင်းသီးသန့်
      todayDeposit: depositIncome, // ငွေဖြည့်သွင်းမှုသီးသန့်
      todayWithdraw: expense,
      netProfit: netProfit,
    };
  }

  @Get('products/:id')
  async getProduct(@Param('id', ParseIntPipe) id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        keys: {
          where: { isUsed: false }, // We include all keys, the frontend will filter !isUsed
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  // This handles the "Add Keys" button logic
  @Post('products/:id/keys')
  async addKeys(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { keys: string[] },
  ) {
    const { keys } = body;

    const data = keys.map((key) => ({
      key: key.trim(),
      productId: id,
    }));

    await this.prisma.productKey.createMany({
      data: data,
    });

    return { success: true, count: keys.length };
  }

  // Standard Update Product (for the Edit button)
  // @Patch('products/:id')
  // async updateProduct(
  //   @Param('id', ParseIntPipe) id: number,
  //   @Body() data: any,
  // ) {
  //   return await this.prisma.product.update({
  //     where: { id },
  //     data,
  //   });
  // }
  // 1. Rigged List အားလုံးကို ဆွဲထုတ်ခြင်း (READ)
  @Get('lucky-draw/rigged')
  async getRiggedWinners() {
    const winners = await this.prisma.predefinedWinner.findMany({
      orderBy: { id: 'desc' },
    });

    // BigInt ကို JSON ပို့နိုင်ရန် String ပြောင်းပေးရမည်
    return winners.map((w) => ({
      ...w,
      telegramId: w.telegramId.toString(),
    }));
  }

  // 2. Winner အသစ်သတ်မှတ်ခြင်း (CREATE / UPDATE)
  // @Post('lucky-draw/rigged')
  // async setRiggedWinner(
  //   @Body() body: { telegramId: string; prizeType: string },
  // ) {
  //   const { telegramId, prizeType } = body;

  //   if (!telegramId || !prizeType) {
  //     throw new BadRequestException('Telegram ID နှင့် Prize Type လိုအပ်ပါသည်');
  //   }

  //   const result = await this.prisma.predefinedWinner.upsert({
  //     where: { telegramId: BigInt(telegramId) },
  //     update: { prizeType },
  //     create: {
  //       telegramId: BigInt(telegramId),
  //       prizeType,
  //     },
  //   });

  //   return {
  //     success: true,
  //     data: { ...result, telegramId: result.telegramId.toString() },
  //   };
  // }

  // 3. Rigged စာရင်းမှ ဖျက်ခြင်း (DELETE)
  @Delete('lucky-draw/rigged/:id')
  async deleteRiggedWinner(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.prisma.predefinedWinner.delete({
        where: { id },
      });
      return { success: true, message: 'Rigged winner removed' };
    } catch (error) {
      throw new NotFoundException('Winner ကို ရှာမတွေ့ပါ');
    }
  }

  // 4. Lucky Draw Participants စာရင်းကို ကြည့်ခြင်း (Optional - Monitoring အတွက်)
  @Get('lucky-draw/participants')
  async getParticipants() {
    const participants = await this.prisma.luckyDrawParticipant.findMany({
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });

    return participants.map((p) => ({
      ...p,
      user: {
        ...p.user,
        telegramId: p.user.telegramId.toString(),
        balance: p.user.balance.toString(),
      },
    }));
  }

  // ၁။ ပါဝင်သူအားလုံးကို Pagination ဖြင့် ကြည့်ရှုခြင်း (READ - List)
  @Get('lucky-draw/participants')
  async getAllParticipants(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
  ) {
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.max(1, parseInt(limit) || 10);
    const skip = (p - 1) * l;

    const whereClause: any = {};
    if (search) {
      whereClause.OR = [
        { ticketId: { contains: search, mode: 'insensitive' } },
        { playerId: { contains: search, mode: 'insensitive' } },
        { accName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [participants, total] = await Promise.all([
      this.prisma.luckyDrawParticipant.findMany({
        where: whereClause,
        skip,
        take: l,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.luckyDrawParticipant.count({ where: whereClause }),
    ]);

    const formatted = participants.map((p) => ({
      ...p,
      user: {
        id: p.user.id,
        telegramId: p.user.telegramId.toString(),
        username: p.user.username,
        firstName: p.user.firstName,
      },
    }));

    return {
      data: formatted,
      meta: {
        total,
        page: p,
        lastPage: Math.ceil(total / l) || 1,
      },
    };
  }

  // ၂။ ပါဝင်သူတစ်ဦးချင်းစီ၏ အချက်အလက်ကို ကြည့်ခြင်း (READ - Single)
  @Get('lucky-draw/participants/:id')
  async getParticipant(@Param('id', ParseIntPipe) id: number) {
    const participant = await this.prisma.luckyDrawParticipant.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!participant) throw new NotFoundException('Participant not found');

    return {
      ...participant,
      user: {
        ...participant.user,
        telegramId: participant.user.telegramId.toString(),
      },
    };
  }

  // ၃။ ပါဝင်သူ၏ Game Info သို့မဟုတ် ဆုအခြေအနေကို ပြင်ဆင်ခြင်း (UPDATE)
  @Patch('lucky-draw/participants/:id')
  async updateParticipant(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      playerId?: string;
      serverId?: string;
      accName?: string;
      isWinner?: boolean;
      prize?: string;
    },
  ) {
    try {
      const updated = await this.prisma.luckyDrawParticipant.update({
        where: { id },
        data: body,
      });
      return { success: true, data: updated };
    } catch (error) {
      throw new BadRequestException('ပြင်ဆင်မှု မအောင်မြင်ပါ');
    }
  }

  // ၄။ ပါဝင်သူကို စာရင်းမှ ပယ်ဖျက်ခြင်း (DELETE)
  @Delete('lucky-draw/participants/:id')
  async deleteParticipant(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.prisma.luckyDrawParticipant.delete({
        where: { id },
      });
      return { success: true, message: 'Participant removed successfully' };
    } catch (error) {
      throw new NotFoundException('ဖျက်လိုသော data ရှာမတွေ့ပါ');
    }
  }
  // 2. Winner အသစ်သတ်မှတ်ခြင်း (CREATE / UPDATE with Participant Check)
  @Post('lucky-draw/rigged')
  async setRiggedWinner(
    @Body() body: { telegramId: string; prizeType: string },
  ) {
    const { telegramId, prizeType } = body;

    if (!telegramId || !prizeType) {
      throw new BadRequestException('Telegram ID နှင့် Prize Type လိုအပ်ပါသည်');
    }

    // ၁။ Participant List ထဲမှာ ဒီ User ရှိမရှိ အရင်စစ်ဆေးပါ
    const participant = await this.prisma.luckyDrawParticipant.findFirst({
      where: {
        user: {
          telegramId: BigInt(telegramId),
        },
      },
      include: { user: true },
    });

    if (!participant) {
      throw new NotFoundException(
        'ဤ Telegram ID သည် ကံစမ်းမဲစာရင်း (Participant List) ထဲတွင် မရှိသေးပါ။',
      );
    }

    // ၂။ ရှိတယ်ဆိုရင် Predefined table မှာ သိမ်းမယ် (သို့) Update လုပ်မယ်
    const result = await this.prisma.predefinedWinner.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: {
        prizeType,
        // Optional: track who they are in the log
      },
      create: {
        telegramId: BigInt(telegramId),
        prizeType,
      },
    });

    return {
      success: true,
      message: `${participant.accName} ကို ${prizeType} အဖြစ် သတ်မှတ်လိုက်ပါပြီ။`,
      data: {
        ...result,
        telegramId: result.telegramId.toString(),
        accName: participant.accName, // Frontend မှာ ပြဖို့ Name ပါ ထည့်ပေးလိုက်မယ်
        ticketId: participant.ticketId,
      },
    };
  }

  @Get('orders')
  async getAllOrders(
    @Query('status') status?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10', // Dashboard အတွက် 10 က ပိုသင့်တော်ပါတယ်
  ) {
    // ၁။ Query Params များကို ကိန်းဂဏန်းအဖြစ်ပြောင်းလဲခြင်း (Validation အပါအဝင်)
    const p = Math.max(1, parseInt(page) || 1); // အနည်းဆုံး 1 ဖြစ်ရမယ်
    const l = Math.max(1, parseInt(limit) || 10); // အနည်းဆုံး 1 ဖြစ်ရမယ်
    const skip = (p - 1) * l;

    const whereClause: any = {};
    if (status && status !== 'ALL') {
      whereClause.status = status;
    }

    // ၂။ Database မှ Data နှင့် စုစုပေါင်းအရေအတွက်ကို တပြိုင်တည်းဆွဲယူခြင်း
    const [orders, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where: whereClause,
        skip,
        take: l,
        orderBy: { createdAt: 'desc' },
        include: {
          user: true,
          product: true,
        },
      }),
      this.prisma.purchase.count({ where: whereClause }),
    ]);

    // ၃။ Frontend အတွက် Data Format ပြင်ဆင်ခြင်း
    const formattedOrders = orders.map((order) => ({
      ...order,
      amount: order.amount.toString(),
      // Prisma model မှာ nickname မပါသေးရင် (order as any) သုံးလို့ရပေမဲ့ database မှာ ရှိဖို့တော့လိုပါတယ်
      nickname: (order as any).nickname || 'N/A',
      user: {
        ...order.user,
        telegramId: order.user.telegramId.toString(),
        balance: order.user.balance.toString(),
      },
    }));

    // ၄။ Pagination Meta Data ပြန်ပေးခြင်း
    const lastPage = Math.ceil(total / l);

    return {
      data: formattedOrders,
      meta: {
        total,
        page: p,
        lastPage: lastPage || 1, // data မရှိရင်လည်း 1 လို့ပြမယ်
        limit: l,
      },
    };
  }
  @Get('products')
  async getAllProducts() {
    const products = await this.prisma.product.findMany({
      include: {
        _count: {
          select: {
            keys: {
              where: { isUsed: false }, // Only count keys that haven't been sold
            },
          },
        },
      },
    });

    // We map the data so the frontend receives a simple 'stock' number
    return products.map((p) => ({
      ...p,
      stock: p._count.keys,
    }));
  }

  @Get('blocked-numbers')
  getBlockedNumbers() {
    // Reads instantly from memory
    return { blockedNumbers: this.settingsService.getBlockedNumbers() };
  }

  @Post('blocked-numbers')
  async updateBlockedNumbers(@Body('numbers') numbers: string[]) {
    // Updates DB and memory
    const updatedNumbers =
      await this.settingsService.updateBlockedNumbers(numbers);

    return {
      message: 'Blocked numbers updated successfully',
      blockedNumbers: updatedNumbers,
    };
  }

  @Get('users')
  async getAllUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string, // ရှာဖွေလိုပါက search ပါ ထည့်ပေးထားသည်
  ) {
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.max(1, parseInt(limit) || 10);
    const skip = (p - 1) * l;

    // Search query logic (Optional: Username သို့မဟုတ် ID ဖြင့် ရှာရန်)
    const whereClause: any = {};
    if (search) {
      whereClause.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        // BigInt ဖြစ်တဲ့အတွက် telegramId ကို string နဲ့ ရှာချင်ရင် ရှာလို့မရတာမျိုး ရှိနိုင်လို့ name ကိုပဲ ဦးစားပေးထားပါတယ်
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        skip,
        take: l,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where: whereClause }),
    ]);

    // BigInt များကို String သို့ ပြောင်းလဲခြင်း
    const formattedUsers = users.map((user) => ({
      ...user,
      telegramId: user.telegramId.toString(),
      balance: user.balance.toString(),
    }));

    return {
      data: formattedUsers,
      meta: {
        total,
        page: p,
        lastPage: Math.ceil(total / l) || 1,
        limit: l,
      },
    };
  }

  @Post('toggle-topup')
  async toggleTopUp(@Body() body: { status: boolean }) {
    await this.prisma.systemSetting.upsert({
      where: { key: 'isTopUpOpen' },
      update: { value: body.status.toString() },
      create: { key: 'isTopUpOpen', value: body.status.toString() },
    });
    return { success: true, status: body.status };
  }

  @Get('by-telegram/:tid')
  async getUserByTelegramId(@Param('tid') tid: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        telegramId: BigInt(tid), // BigInt ပြောင်းပြီးရှာမယ်
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 💡 အရေးကြီးသည်: Decimal နှင့် BigInt ကို JSON ပို့ရန် String ပြောင်းပေးရမည်
    return {
      ...user,
      telegramId: user.telegramId.toString(),
      balance: user.balance.toString(),
    };
  }

  @Patch('users/:id/role')
  async updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { role: string; commission?: number },
  ) {
    // ၁။ Check if the role being assigned is 'RESELLER'
    const isResellerRole = body.role === 'RESELLER';
    const commission = body.commission || 0;

    try {
      // ၂။ Database Update
      const user = await this.prisma.user.update({
        where: { id },
        data: {
          // If you have a 'role' field, update it.
          // Otherwise, we toggle the reseller flags you already use.
          isReseller: isResellerRole,
          commission: isResellerRole ? commission : 0,
          // role: body.role, // Uncomment this if you have a 'role' column in Prisma
        },
      });

      // ၃။ Send Telegram Notification (Only if promoted to Reseller)
      if (isResellerRole) {
        try {
          const message =
            `🎉 <b>ဂုဏ်ယူပါတယ်!</b>\n\n` +
            `လူကြီးမင်း၏ အကောင့်ကို <b>Reseller (ကိုယ်စားလှယ်)</b> အဖြစ် အဆင့်မြှင့်တင်ပြီးပါပြီ။\n` +
            `📉 သင်ရရှိမည့် ကော်မရှင်နှုန်း: <b>${commission}%</b>\n\n` +
            `ယခုမှစ၍ 2D/3D ထိုးရာတွင် ${commission}% လျှော့စျေးဖြင့် အလိုအလျောက် ဖြတ်တောက်ပေးသွားမည် ဖြစ်ပါသည်။`;

          await this.bot.telegram.sendMessage(
            user.telegramId.toString(),
            message,
            { parse_mode: 'HTML' },
          );
        } catch (tgError: any) {
          console.error('Failed to send role notification:', tgError.message);
        }
      }

      return {
        success: true,
        message: `User role updated to ${body.role}`,
        user: {
          id: user.id,
          isReseller: user.isReseller,
          commission: user.commission,
        },
      };
    } catch (error) {
      console.error('Update Role Error:', error);
      throw new InternalServerErrorException('Role ပြောင်းလဲမှု မအောင်မြင်ပါ');
    }
  }

  @Post('remove-reseller/:id')
  async removeReseller(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.user.update({
      where: { id },
      data: { isReseller: false, commission: 0 },
    });
    return { success: true, message: 'Reseller status removed' };
  }

  @Get('users/:id')
  async getUserDetails(@Param('id', ParseIntPipe) id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        // နောက်ဆုံး ငွေသွင်းမှု ၁၀ ကြိမ်
        deposits: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        // နောက်ဆုံး ငွေထုတ်မှု ၁၀ ကြိမ်
        withdraws: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        // နောက်ဆုံး ထိုးသားမှု ၂၀ ကြိမ်
        bets: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        // ဝယ်ယူမှုမှတ်တမ်းများ
        purchases: {
          include: { product: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!user) throw new BadRequestException('User not found');

    // စုစုပေါင်း ငွေသွင်း/ငွေထုတ် ပမာဏများကို တွက်ချက်ခြင်း (Optional)
    const totalDeposit = user.deposits
      .filter((d) => d.status === 'APPROVED')
      .reduce((acc, curr) => acc + Number(curr.amount), 0);

    const totalWithdraw = user.withdraws
      .filter((w) => w.status === 'APPROVED')
      .reduce((acc, curr) => acc + Number(curr.amount), 0);

    return { ...user, totalDeposit, totalWithdraw };
  }

  @Get('get-image-url/:fileId')
  async getImageUrl(@Param('fileId') fileId: string) {
    try {
      const file = await this.bot.telegram.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      return { url };
    } catch (error) {
      throw new BadRequestException('Failed to get image from Telegram');
    }
  }

  @Post('approve-withdraw/:id')
  async approve(@Param('id', ParseIntPipe) id: number) {
    // 1. အရင်ဆုံး status ကို DB မှာ approve လုပ်ပါတယ်
    await this.withdrawService.approveWithdraw(id);

    // 2. Database ထဲက အချက်အလက်ကို ပြန်ဆွဲထုတ်ပြီး Telegram Message ID ရှိမရှိ စစ်ပါတယ်
    const record = await this.prisma.withdraw.findUnique({
      where: { id },
      include: { user: true },
    });

    // 3. Message ID ရှိခဲ့ရင် Bot ထဲက Message ကို Edit လုပ်ပါမယ်
    if (record && record.adminMessageId) {
      try {
        await this.bot.telegram.editMessageText(
          process.env.ADMIN_CHANNEL_ID, // Bot Admin ရဲ့ Chat ID
          parseInt(record.adminMessageId),
          undefined, // inline_message_id
          `✅ <b>Approved via Dashboard</b>\n\n` +
            `👤 User: <b>${record.user.firstName || 'User'}</b>\n` +
            `💰 Amount: <b>${record.amount.toLocaleString()} MMK</b>\n` +
            `🏦 Method: <b>${record.method}</b>\n` +
            `📱 Phone: <code>${record.phoneNumber}</code>\n\n` +
            `✨ <i>Admin Panel မှတစ်ဆင့် အတည်ပြုပြီးပါပြီ။</i>`,
          { parse_mode: 'HTML' },
        );
      } catch (error: any) {
        console.error('Telegram Edit Error:', error.message);
        // Message က Admin ဘက်မှာ ဖျက်လိုက်တာမျိုးဆိုရင် Edit လို့မရလို့ Error တက်နိုင်ပါတယ်
      }
    }

    return { success: true };
  }

  @Post('reject-withdraw/:id')
  async reject(@Param('id', ParseIntPipe) id: number) {
    await this.withdrawService.rejectWithdraw(id);
    return { success: true };
  }

  @Post('approve-deposit/:id')
  async approveDep(@Param('id', ParseIntPipe) id: number) {
    return await this.withdrawService.approveDeposit(id);
  }

  // admin.controller.ts ထဲသို့ ထည့်ရန်

  @Get('transactions')
  async getAllTransactions(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const p = parseInt(page);
    const l = parseInt(limit);
    const skip = (p - 1) * l;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        skip,
        take: l,
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      }),
      this.prisma.transaction.count(),
    ]);

    return {
      data: transactions.map((t) => ({
        ...t,
        amount: t.amount.toString(),
        telegramId: t.user.telegramId.toString(),
        username: t.user.username || t.user.firstName || 'Unknown',
      })),
      meta: {
        total,
        page: p,
        lastPage: Math.ceil(total / l),
      },
    };
  }

  @Post('reject-deposit/:id')
  async rejectDep(@Param('id', ParseIntPipe) id: number) {
    // 1. Update the status AND include the user so we get the Telegram ID
    const deposit = await this.prisma.deposit.update({
      where: { id },
      data: { status: 'REJECTED' },
      include: { user: true },
    });

    if (!deposit) throw new NotFoundException('Deposit not found');

    // 2. Send the Telegram Notification via the Bot instance
    try {
      const userTid = deposit.user.telegramId.toString(); // BigInt safe
      const amountStr = Number(deposit.amount).toLocaleString();

      await this.bot.telegram.sendMessage(
        userTid,
        `❌ <b>Deposit Rejected (via Dashboard)</b>\n\n` +
          `လူကြီးမင်း ပေးပို့ထားသော ${amountStr} MMK ငွေဖြည့်သွင်းမှုကို Admin မှ Dashboard မှတစ်ဆင့် ငြင်းပယ်လိုက်ပါသည်။\n\n` +
          `အကယ်၍ အမှားအယွင်းရှိသည်ဟု ထင်မြင်ပါက Support သို့ ဆက်သွယ်နိုင်ပါသည်။`,
        { parse_mode: 'HTML' },
      );
    } catch (error: any) {
      // We log the error but don't fail the request,
      // because the DB update was already successful.
      console.error('Failed to send rejection notification:', error.message);
    }

    return {
      success: true,
      message: 'Deposit rejected and user notified',
    };
  }

  @Get('settings')
  async getSettings() {
    const settings = await this.prisma.systemSetting.findMany();
    // တန်ဖိုးများကို Object format ပြောင်းပေးခြင်း
    return settings.reduce(
      (acc, curr) => ({ ...acc, [curr.key]: curr.value }),
      {},
    );
  }

  @Post('deduct-balance')
  async deductBalance(
    @Body() body: { userId: number; amount: number; reason: string },
  ) {
    const { userId, amount, reason } = body;

    // ၁။ Validation
    if (!userId || !amount || amount <= 0) {
      throw new BadRequestException(
        'User ID နှင့် မှန်ကန်သော ပမာဏ လိုအပ်ပါသည်',
      );
    }

    try {
      // ၂။ Database Transaction (Balance နှုတ်ခြင်း နှင့် မှတ်တမ်းသွင်းခြင်း)
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });

        if (!user) throw new NotFoundException('User ရှာမတွေ့ပါ');
        if (Number(user.balance) < amount) {
          throw new BadRequestException(
            'User တွင် နှုတ်ရန် လက်ကျန်ငွေ မလုံလောက်ပါ',
          );
        }

        // Balance ကို နှုတ်သည်
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { balance: { decrement: amount } },
        });

        // Transaction Table တွင် မှတ်တမ်းသွင်းသည်
        await tx.transaction.create({
          data: {
            userId: userId,
            amount: amount,
            type: 'PURCHASE', // သင့် Enum ရှိ PURCHASE ကို သုံးထားသည်
            description: `Admin Manual Deduct: ${reason}`,
          },
        });

        return updatedUser;
      });

      // ၃။ User ထံသို့ Telegram Notification ပို့ခြင်း
      try {
        const message =
          `💸 <b>သင့်အကောင့်မှ ငွေနှုတ်ယူခြင်း ခံရပါသည်</b>\n\n` +
          `💰 နှုတ်ယူသည့် ပမာဏ: <b>${amount.toLocaleString()} MMK</b>\n` +
          `📝 အကြောင်းပြချက်: <b>${reason}</b>\n` +
          `💵 လက်ကျန်ငွေ: <b>${Number(result.balance).toLocaleString()} MMK</b>`;

        await this.bot.telegram.sendMessage(
          result.telegramId.toString(),
          message,
          {
            parse_mode: 'HTML',
          },
        );
      } catch (tgError: any) {
        console.error(
          'Failed to send deduction notification:',
          tgError.message,
        );
      }

      return {
        success: true,
        message: 'Balance deducted successfully',
        newBalance: result.balance.toString(),
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Deduct Balance Error:', error);
      throw new InternalServerErrorException('ငွေနှုတ်ယူမှု လုပ်ဆောင်၍မရပါ');
    }
  }

  @Post('add-balance')
  async addBalance(
    @Body() body: { userId: number; amount: number; reason: string },
  ) {
    const { userId, amount, reason } = body;

    // ၁။ Validation
    if (!userId || !amount || amount <= 0) {
      throw new BadRequestException(
        'User ID နှင့် မှန်ကန်သော ပမာဏ လိုအပ်ပါသည်',
      );
    }

    try {
      // ၂။ Database Transaction (Balance ပေါင်းခြင်း နှင့် မှတ်တမ်းသွင်းခြင်း)
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });

        if (!user) throw new NotFoundException('User ရှာမတွေ့ပါ');

        // Balance ကို တိုးမြှင့်သည်
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: amount } },
        });

        // Transaction Table တွင် မှတ်တမ်းသွင်းသည် (DEPOSIT type ကို သုံးထားသည်)
        await tx.transaction.create({
          data: {
            userId: userId,
            amount: amount,
            type: 'DEPOSIT',
            description: `Admin Manual Deposit: ${reason || 'No reason provided'}`,
          },
        });

        return updatedUser;
      });

      // ၃။ User ထံသို့ Telegram Notification ပို့ခြင်း
      try {
        const message =
          `✅ <b>သင့်အကောင့်ထဲသို့ ငွေဖြည့်သွင်းမှု အောင်မြင်ပါသည်</b>\n\n` +
          `💰 ဖြည့်သွင်းသည့် ပမာဏ: <b>${amount.toLocaleString()} MMK</b>\n` +
          `📝 မှတ်ချက်: <b>${reason || 'Admin Manual Deposit'}</b>\n` +
          `💵 လက်ရှိလက်ကျန်ငွေ: <b>${Number(result.balance).toLocaleString()} MMK</b>`;

        await this.bot.telegram.sendMessage(
          result.telegramId.toString(),
          message,
          {
            parse_mode: 'HTML',
          },
        );
      } catch (tgError: any) {
        console.error('Failed to send deposit notification:', tgError.message);
      }

      return {
        success: true,
        message: 'Balance added successfully',
        newBalance: result.balance.toString(),
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      console.error('Add Balance Error:', error);
      throw new InternalServerErrorException('ငွေဖြည့်သွင်းမှု လုပ်ဆောင်၍မရပါ');
    }
  }

  @Post('purchase')
  async purchaseProduct(
    @Body()
    body: {
      telegramId: string;
      productId: number;
      playerId?: string; // Game ID အတွက်
      serverId?: string; // Game Server အတွက်
      nickname?: string; // Game Nickname အတွက်
    },
  ) {
    const { telegramId, productId, playerId, serverId, nickname } = body;

    return this.prisma.$transaction(async (tx) => {
      // ၁။ User နှင့် Product ရှိမရှိ စစ်ဆေးခြင်း
      const tid = BigInt(telegramId);
      const user = await tx.user.findUnique({ where: { telegramId: tid } });
      const product = await tx.product.findUnique({ where: { id: productId } });

      if (!user) throw new BadRequestException('User ကို ရှာမတွေ့ပါ');
      if (!product) throw new BadRequestException('Product ကို ရှာမတွေ့ပါ');

      // ၂။ လက်ကျန်ငွေ စစ်ဆေးခြင်း
      if (Number(user.balance) < Number(product.price)) {
        throw new BadRequestException('လက်ကျန်ငွေ မလုံလောက်ပါ');
      }

      // --- TYPE: AUTO (Digital Keys) ---
      if (product.type === 'AUTO') {
        // အသုံးမပြုရသေးသော Key တစ်ခုကို ရှာမည်
        const productKey = await tx.productKey.findFirst({
          where: { productId: product.id, isUsed: false },
        });

        if (!productKey) {
          throw new BadRequestException(
            'ပစ္စည်း လက်ကျန်မရှိတော့ပါ။ မကြာမီ ပြန်ဖြည့်ပေးပါမည်။',
          );
        }

        // ငွေနှုတ်ပြီး Status ကို တစ်ခါတည်း Update လုပ်မည်
        await tx.user.update({
          where: { id: user.id },
          data: { balance: { decrement: product.price } },
        });

        await tx.productKey.update({
          where: { id: productKey.id },
          data: { isUsed: true },
        });

        const purchase = await tx.purchase.create({
          data: {
            userId: user.id,
            productId: product.id,
            amount: product.price,
            status: 'COMPLETED',
          },
        });

        // Telegram သို့ Key ပို့ပေးခြင်း
        await this.bot.telegram.sendMessage(
          telegramId,
          `✅ <b>ဝယ်ယူမှု အောင်မြင်ပါသည်!</b>\n\n` +
            `📦 ပစ္စည်း: ${product.name}\n` +
            `🔑 Key: <code>${productKey.key}</code>\n\n` +
            `ကျေးဇူးတင်ပါသည်။`,
          { parse_mode: 'HTML' },
        );

        return {
          success: true,
          message: 'Purchase completed',
          key: productKey.key,
        };
      }

      // --- TYPE: MANUAL (Game Top-up) ---
      else {
        if (!playerId) throw new BadRequestException('Player ID လိုအပ်ပါသည်');

        // ငွေနှုတ်မည်
        await tx.user.update({
          where: { id: user.id },
          data: { balance: { decrement: product.price } },
        });

        // PENDING Order အနေဖြင့် မှတ်တမ်းသွင်းမည်
        const purchase = await tx.purchase.create({
          data: {
            userId: user.id,
            productId: product.id,
            amount: product.price,
            status: 'PENDING',
            playerId: playerId,
            serverId: serverId || null,
            // schema ပေါ်မူတည်၍ nickname ပါလျှင် ထည့်ပါ
          },
        });

        // Admin ထံ Notification ပို့ခြင်း
        const adminChannelId = process.env.ADMIN_CHANNEL_ID;
        await this.bot.telegram.sendMessage(
          adminChannelId,
          `🛒 <b>Order အသစ်ရောက်ရှိပါသည်!</b>\n` +
            `➖➖➖➖➖➖➖➖➖➖\n` +
            `👤 User: ${user.firstName}\n` +
            `📦 ပစ္စည်း: ${product.name}\n` +
            `🆔 Player ID: <code>${playerId}</code>\n` +
            `🌐 Server: ${serverId || 'N/A'}\n` +
            `💰 နှုတ်ယူငွေ: ${product.price.toLocaleString()} MMK\n` +
            `#Order_${purchase.id}`,
          { parse_mode: 'HTML' },
        );

        return {
          success: true,
          message: 'Order submitted and pending approval',
        };
      }
    });
  }

  @Get('validate-mlbb')
  async validateMLBB(
    @Query('id') id: string,
    @Query('serverid') serverid: string,
  ) {
    try {
      const res = await axios.get(
        `https://cekidml.caliph.dev/api/validasi?id=${id}&serverid=${serverid}`,
        { timeout: 8000 },
      );
      return res.data;
    } catch (error) {
      throw new HttpException('API Error', HttpStatus.BAD_GATEWAY);
    }
  }

  @Post('update-settings')
  async updateSettings(
    @Body()
    settings: {
      winRatio: number;
      minBet: number;
      maxBet: number;
      payoutMultiplier: number;
    },
  ) {
    try {
      const updates = Object.entries(settings).map(([key, value]) => {
        return this.prisma.systemSetting.upsert({
          where: { key: key },
          update: { value: value.toString() },
          create: {
            key: key,
            value: value.toString(),
          },
        });
      });

      await Promise.all(updates);
      return { success: true, message: 'Settings updated successfully' };
    } catch (error) {
      console.error('Upsert Error:', error);
      throw new BadRequestException('Failed to update settings');
    }
  }

  @Post('settle-result')
  async settleResult(
    @Body()
    body: {
      type: '2D' | '3D';
      winNumber: string;
      session?: 'MORNING' | 'EVENING';
    },
  ) {
    const { type, winNumber } = body;

    // ၁။ Session ကို Body ကနေယူမယ်၊ မပါလာမှ အချိန်နဲ့တွက်မယ်
    let targetSession = body.session;

    if (!targetSession) {
      const now = new Date();
      const mmTime = new Date(
        now.toLocaleString('en-US', { timeZone: 'Asia/Yangon' }),
      );
      targetSession = mmTime.getHours() < 13 ? 'MORNING' : 'EVENING';
    }

    // ၂။ Bet များကို Fetch လုပ်ခြင်း
    const bets = await this.prisma.bet.findMany({
      where: {
        type,
        session: targetSession,
        status: 'PENDING',
      },
      include: { user: true },
    });

    if (bets.length === 0) {
      return {
        success: false,
        winCount: 0,
        message: `${targetSession} အတွက် တွက်ချက်ရန် Bet မရှိပါ`,
      };
    }

    const userResults = new Map<
      number,
      {
        telegramId: string;
        winNumbers: string[];
        loseNumbers: string[];
        totalWinAmount: number;
      }
    >();

    let winCount = 0;

    // ၃။ Database Processing
    // settle-result loop ထဲမှာ ပြင်ရန်
    for (const bet of bets) {
      const userId = bet.userId;
      if (!userResults.has(userId)) {
        userResults.set(userId, {
          telegramId: bet.user.telegramId.toString(),
          winNumbers: [],
          loseNumbers: [],
          totalWinAmount: 0,
        });
      }

      const data = userResults.get(userId); // <--- userData ကနေ data လို့ ပြောင်းထားတယ်

      if (bet.number === winNumber) {
        const multiplier = type === '2D' ? 80 : 500;
        const winAmount = Number(bet.amount) * multiplier;

        // Transaction တစ်ခုချင်းစီအစား ပေါင်းပြီးမှ လုပ်တာ ပိုကောင်းပေမယ့်
        // အခုအတိုင်း သုံးမယ်ဆိုရင်တောင် data ထဲကို အရင်ထည့်ပါ
        data.winNumbers.push(bet.number);
        data.totalWinAmount += winAmount;
        winCount++;

        await this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: userId },
            data: { balance: { increment: winAmount } },
          }),
          this.prisma.bet.update({
            where: { id: bet.id },
            data: { status: 'WIN' },
          }),
          this.prisma.transaction.create({
            data: {
              userId,
              amount: winAmount,
              type: TransactionType.REFUND,
              description: `${type} (${targetSession}) ပေါက်ဂဏန်း ${winNumber} အနိုင်ရငွေ`,
            },
          }),
        ]);
      } else {
        await this.prisma.bet.update({
          where: { id: bet.id },
          data: { status: 'LOSE' },
        });
        data.loseNumbers.push(bet.number);
      }
    }

    // ၄။ Telegram Notifications (Logic ပြင်ဆင်ထားသည့်အပိုင်း)
    const notificationPromises = Array.from(userResults.entries()).map(
      async ([userId, data]) => {
        let message = `🔔 <b>${type} (${targetSession}) ရလဒ် ထွက်ပေါ်လာပါပြီ (${winNumber})</b>\n\n`;

        // ✅ အနိုင်ရရှိသူဖြစ်မှသာ ငွေထည့်သွင်းကြောင်း စာသားထည့်မည်
        if (data.winNumbers.length > 0) {
          message += `🎉 <b>ဂုဏ်ယူပါတယ်!</b>\n`;
          message += `✅ ပေါက်ဂဏန်း: <b>${data.winNumbers.join(', ')}</b>\n`;
          message += `💰 စုစုပေါင်းအနိုင်ရငွေ: <b>${data.totalWinAmount.toLocaleString()} MMK</b>\n`;
          message += `ℹ️ <i>လက်ကျန်ငွေထဲသို့ အလိုအလျောက် ထည့်သွင်းပေးပြီးပါပြီ။</i>\n\n`;
        }

        if (data.loseNumbers.length > 0) {
          message += `😞 <b>မပေါက်သောဂဏန်းများ:</b>\n`;
          message += `❌ ${data.loseNumbers.join(', ')}\n\n`;
        }

        try {
          await this.bot.telegram.sendMessage(data.telegramId, message, {
            parse_mode: 'HTML',
          });
        } catch (e) {
          console.error(`Telegram failed for user ${userId}:`, e);
        }
      },
    );

    await Promise.allSettled(notificationPromises);

    return {
      success: true,
      winCount,
      totalBets: bets.length,
      message: `${type} ${targetSession} Result (${winNumber}) ထုတ်ပြန်ပြီးပါပြီ။`,
    };
  }
  //  // System Settings ကို Database မှ ဆွဲယူသည့် Helper Method
  //   private async getSettings(): Promise<Record<string, string>> {
  //     const settings = await this.prisma.systemSetting.findMany();
  //     return settings.reduce((acc, item) => {
  //       acc[item.key] = item.value;
  //       return acc;
  //     }, {});
  //   }

  @Post('high-low/play')
  async play(
    @Body()
    body: {
      telegramId: string;
      amount: number;
      choice: 'HIGH' | 'LOW';
    },
  ) {
    const { telegramId, amount, choice } = body;

    // 1. Validation & User Check
    if (!telegramId || !amount || !choice) {
      throw new BadRequestException('Data ပြည့်စုံစွာ ပေးပို့ပေးပါ');
    }

    const tid = BigInt(telegramId);
    const user = await this.prisma.user.findUnique({
      where: { telegramId: tid },
    });

    if (!user) {
      throw new BadRequestException('User ကို ရှာမတွေ့ပါ');
    }

    if (Number(user.balance) < amount) {
      throw new BadRequestException('လက်ကျန်ငွေ မလုံလောက်ပါ');
    }

    // 2. Load Settings from DB
    const settings = await this.getSettings();
    const minBet = parseInt(settings['minBet'] || '500');
    const maxBet = parseInt(settings['maxBet'] || '100000');
    const winRatio = parseInt(settings['winRatio'] || '40');
    const multiplier = parseFloat(settings['payoutMultiplier'] || '1.8');

    // 3. Min/Max Bet Limit Validation
    if (amount < minBet) {
      throw new BadRequestException(
        `အနည်းဆုံးထိုးငွေမှာ ${minBet.toLocaleString()} MMK ဖြစ်ပါသည်။`,
      );
    }
    if (amount > maxBet) {
      throw new BadRequestException(
        `အများဆုံးထိုးငွေမှာ ${maxBet.toLocaleString()} MMK သာဖြစ်ပါသည်။`,
      );
    }

    // 4. Win/Lose Logic (RTP Base + Hard Cap)

    // အဆင့် (က) - Random နှိုက်ပြီး နိုင်မနိုင် အရင်ဆုံးဖြတ်သည်
    let isWin = Math.floor(Math.random() * 100) < winRatio;

    // အဆင့် (ခ) - Win Limit စစ်ဆေးခြင်း
    const potentialPayout = amount * multiplier;
    const hardWinLimit = 30000; // လူကြီးမင်းသတ်မှတ်လိုသော Max Win Limit (ဥပမာ - ၁၅,၀၀၀)
    const doubleBetLimit = amount * 2; // Bet တင်ကြေး၏ ၂ ဆ ထက် မပိုစေရန်

    // အကယ်၍ နိုင်ရန် ဖြစ်နေသော်လည်း Limit ကျော်နေပါက အရှုံးသို့ ပြောင်းမည်
    if (isWin) {
      if (potentialPayout > hardWinLimit || potentialPayout > doubleBetLimit) {
        isWin = false; // Force Lose
      }
    }

    // 5. Result Number Generation (isWin အပေါ်မူတည်၍ ဂဏန်းထုတ်ပေးခြင်း)
    let resultNum: number;
    if (isWin) {
      // နိုင်ရမည် - High ဆိုလျှင် ၅၀-၉၉ ကြား၊ Low ဆိုလျှင် ၀-၄၉ ကြား
      resultNum =
        choice === 'HIGH'
          ? Math.floor(Math.random() * 50) + 50
          : Math.floor(Math.random() * 50);
    } else {
      // ရှုံးရမည် - High ဆိုလျှင် ၀-၄၉ ကြား၊ Low ဆိုလျှင် ၅၀-၉၉ ကြား
      resultNum =
        choice === 'HIGH'
          ? Math.floor(Math.random() * 50)
          : Math.floor(Math.random() * 50) + 50;
    }

    const payout = isWin ? potentialPayout : 0;

    // 6. Database Transaction (Balance Update & Bet Recording)
    const result = await this.prisma.$transaction(async (tx) => {
      // ၁။ ပိုက်ဆံ အရင်နှုတ်မည်
      await tx.user.update({
        where: { id: user.id },
        data: { balance: { decrement: amount } },
      });

      // 💡 ငွေနှုတ်ယူမှု Transaction မှတ်တမ်း
      await tx.transaction.create({
        data: {
          userId: user.id,
          amount: amount,
          type: 'PURCHASE',
          description: `High/Low ဂိမ်းလောင်းကြေး (${choice})`,
        },
      });

      // ၂။ Bet မှတ်တမ်းသွင်းမည်
      const betRecord = await tx.highLowBet.create({
        data: {
          userId: user.id,
          amount,
          choice,
          resultNum,
          status: isWin ? 'WIN' : 'LOSE',
          payout,
        },
      });

      // ၃။ နိုင်လျှင် ပိုက်ဆံပြန်ပေါင်းပေးမည်
      let finalUser;
      if (isWin) {
        finalUser = await tx.user.update({
          where: { id: user.id },
          data: { balance: { increment: payout } },
        });

        // 💡 အနိုင်ရငွေ Transaction မှတ်တမ်း
        await tx.transaction.create({
          data: {
            userId: user.id,
            amount: payout,
            type: 'REFUND',
            description: `High/Low ဂိမ်းအနိုင်ရငွေ (ဂဏန်း: ${resultNum})`,
          },
        });
      } else {
        finalUser = await tx.user.findUnique({
          where: { id: user.id },
        });
      }

      return { betRecord, finalUser };
    });

    // 7. Return Response to Web App
    return {
      success: true,
      resultNum: result.betRecord.resultNum,
      status: result.betRecord.status,
      payout: Number(result.betRecord.payout),
      newBalance: Number(result.finalUser.balance),
      isWin: isWin,
      message: isWin ? '🎉 You Win!' : '😞 You Lose!',
    };
  }

  // --- 💡 Telegram သို့ Notification ပို့ခြင်း (Sync ဖြစ်စေရန်) ---
  // const resultEmoji = isWin ? '🎉' : '😢';
  // const statusText = isWin ? `နိုင်ပါတယ် (Winner)` : `ရှုံးပါတယ် (Loser)`;

  // try {
  //   await this.bot.telegram.sendMessage(
  //     Number(telegramId),
  //     `${resultEmoji} <b>High/Low Result</b>\n\n` +
  //       `ဂဏန်း: <b>${resultNum}</b> (${resultNum >= 50 ? 'HIGH' : 'LOW'})\n` +
  //       `ရလဒ်: <b>${statusText}</b>\n` +
  //       `ပမာဏ: <b>${isWin ? '+' : '-'}${isWin ? payout : amount} MMK</b>\n\n` +
  //       `💰 လက်ကျန်ငွေ: <b>${Number(updatedUser.balance).toLocaleString()} MMK</b>`,
  //     { parse_mode: 'HTML' },
  //   );
  // } catch (e) {
  //   console.error('Failed to send TG message:', e);
  // }

  //   return {
  //     resultNum,
  //     isWin,
  //     payout,
  //     newBalance: Number(updatedUser.balance),
  //   };
  // }

  // private async getSettings() {
  //   const settings = await this.prisma.systemSetting.findMany();
  //   return settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});
  // }

  // 1. Create Product (Updated with 'type')
  // --- PRODUCT MANAGEMENT ---

  // ၁။ Product အသစ်ဖန်တီးခြင်း (Subcategory ပါဝင်သည်)
  @Post('products')
  async createProduct(
    @Body()
    body: {
      name: string;
      category: string;
      subCategory?: string;
      description?: string;
      price: number;
      type: 'AUTO' | 'MANUAL' | 'API';
      usageLimitGB?: number; // Added this
      packageDays?: number; // Added this
    },
  ) {
    try {
      const product = await this.prisma.product.create({
        data: {
          name: body.name,
          category: body.category,
          subCategory: body.subCategory || null,
          description: body.description,
          price: body.price,
          type: body.type,
          usageLimitGB: body.usageLimitGB || 0, // Save to DB
          packageDays: body.packageDays || 30, // Save to DB
        },
      });
      return { success: true, data: product };
    } catch (error) {
      throw new InternalServerErrorException('Product ဖန်တီးမှု မအောင်မြင်ပါ');
    }
  }

  // ၂။ Product အချက်အလက်ပြင်ဆင်ခြင်း
  @Patch('products/:id')
  async updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    try {
      // 1. Destructure to REMOVE fields Prisma doesn't like (stock, keys, _count, id)
      // We only keep the fields defined in your schema.prisma
      const { id: _id, stock, keys, _count, ...validData } = body;

      // 2. Perform the update
      const updatedProduct = await this.prisma.product.update({
        where: { id },
        data: {
          ...validData,
          // Ensure price is handled as a Number/Decimal
          price:
            validData.price !== undefined ? Number(validData.price) : undefined,
        },
      });

      return { success: true, data: updatedProduct };
    } catch (error) {
      // Log the error to your terminal so you can see exactly what went wrong
      console.error('Prisma Update Error:', error);

      throw new BadRequestException(
        'Product update failed. Ensure you are not sending invalid fields.',
      );
    }
  }

  // ၃။ Product ဖျက်ခြင်း
  @Delete('products/:id')
  async deleteProduct(@Param('id', ParseIntPipe) id: number) {
    try {
      // ရှေးဦးစွာ သက်ဆိုင်ရာ Product Keys များကို ဖျက်ပါ (သို့မဟုတ် disconnect လုပ်ပါ)
      await this.prisma.productKey.deleteMany({ where: { productId: id } });

      await this.prisma.product.delete({ where: { id } });
      return { success: true, message: 'Product deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        'ဤ Product တွင် ဝယ်ယူမှုမှတ်တမ်း ရှိနေသောကြောင့် ဖျက်၍မရပါ',
      );
    }
  }

  // --- PRODUCT KEYS (STOCK) MANAGEMENT ---

  // ၄။ Product ထဲသို့ Stock Key များ အများအပြား ထည့်သွင်းခြင်း
  @Post('products/:id/keys')
  async addProductKeys(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { keys: string[] }, // ['KEY1', 'KEY2', 'KEY3']
  ) {
    const { keys } = body;

    const data = keys.map((k) => ({
      key: k,
      productId: id,
      isUsed: false,
    }));

    try {
      await this.prisma.productKey.createMany({
        data: data,
        skipDuplicates: true, // တူညီတဲ့ Key ပါလာရင် ကျော်သွားမယ်
      });
      return {
        success: true,
        message: `${keys.length} keys added successfully`,
      };
    } catch (error) {
      throw new InternalServerErrorException('Keys ထည့်သွင်းမှု မအောင်မြင်ပါ');
    }
  }

  // --- 💡 Game Top-up Order Management (New) ---

  // ၂။ Order ကို အတည်ပြုခြင်း (Done)
  @Post('approve-order/:id')
  async approveOrder(@Param('id', ParseIntPipe) id: number) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { user: true, product: true },
    });

    if (!purchase || purchase.status !== 'PENDING') {
      throw new BadRequestException(
        'အော်ဒါရှာမတွေ့ပါ သို့မဟုတ် ကိုင်တွယ်ပြီးသားဖြစ်နေသည်',
      );
    }

    await this.prisma.purchase.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });

    // Telegram Notification
    const message =
      `✅ <b>ဝယ်ယူမှု အောင်မြင်ပါသည်!</b>\n\n` +
      `📦 ပစ္စည်း: <b>${purchase.product.name}</b>\n` +
      `🎮 အကောင့်အမည်: <b>${(purchase as any).nickname || 'N/A'}</b>\n` +
      `🆔 ID: <code>${purchase.playerId}</code> ${purchase.serverId ? `(${purchase.serverId})` : ''}\n\n` +
      `Admin မှ Diamonds/UC ဖြည့်သွင်းပေးပြီးပါပြီ။ ကျေးဇူးတင်ပါသည်။`;

    try {
      await this.bot.telegram.sendMessage(
        purchase.user.telegramId.toString(),
        message,
        { parse_mode: 'HTML' },
      );
    } catch (e) {
      console.error('Failed to notify user', e);
    }

    return { success: true, message: 'Order completed successfully' };
  }

  // ၃။ Order ကို ပယ်ဖျက်ခြင်း (Reject & Refund)
  @Post('reject-order/:id')
  async rejectOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string }, // Dashboard ကနေ Reject reason ထည့်ချင်ရင် သုံးနိုင်သည်
  ) {
    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { id },
        include: { user: true, product: true },
      });

      if (!purchase || purchase.status !== 'PENDING') {
        throw new BadRequestException(
          'အော်ဒါရှာမတွေ့ပါ သို့မဟုတ် ကိုင်တွယ်ပြီးသားဖြစ်နေသည်',
        );
      }

      // 1. Status Update
      await tx.purchase.update({
        where: { id },
        data: { status: 'REJECTED' },
      });

      // 2. Refund Money
      await tx.user.update({
        where: { id: purchase.userId },
        data: { balance: { increment: purchase.amount } },
      });

      // 3. Transaction History
      await tx.transaction.create({
        data: {
          userId: purchase.userId,
          amount: purchase.amount,
          type: 'REFUND',
          description: `ပယ်ဖျက်လိုက်သော အော်ဒါ #${purchase.id} အတွက် ငွေပြန်အမ်းခြင်း`,
        },
      });

      // 4. Telegram Notification
      const message =
        `❌ <b>ဝယ်ယူမှု ပယ်ဖျက်ခံရပါသည်</b>\n\n` +
        `📦 ပစ္စည်း: ${purchase.product.name}\n` +
        `💰 ပမာဏ: <b>${Number(purchase.amount).toLocaleString()} MMK</b>\n` +
        `ℹ️ အကြောင်းပြချက်: ${body.reason || 'အချက်အလက်မှားယွင်းနေခြင်း'}\n\n` +
        `သင့်အကောင့်ထဲသို့ ငွေပြန်လည်ထည့်သွင်းပေးပြီးပါပြီ။`;

      try {
        await this.bot.telegram.sendMessage(
          purchase.user.telegramId.toString(),
          message,
          { parse_mode: 'HTML' },
        );
      } catch (e) {
        console.error('Failed to notify user', e);
      }

      return { success: true, message: 'Order rejected and refunded' };
    });
  }

  // --- အောက်က Functions တွေက မူလအတိုင်းပဲ ထားနိုင်ပါတယ် ---

  // @Delete('products/:id')
  // async deleteProduct(@Param('id', ParseIntPipe) id: number) {
  //   await this.prisma.productKey.deleteMany({ where: { productId: id } });
  //   return this.prisma.product.delete({ where: { id } });
  // }

  @Post('products/:id/keys')
  async addProductKey(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { key: string },
  ) {
    return this.prisma.productKey.create({
      data: { key: body.key, productId: id, isUsed: false },
    });
  }

  @Post('deposit-with-image')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  async depositWithImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateDepositDto, // 👈 Use DTO instead of 'any'
  ) {
    if (!file) throw new BadRequestException('Image file is missing');

    const { telegramId, amount, method } = body;
    const adminChannelId = process.env.ADMIN_CHANNEL_ID;

    try {
      // 1. Send to Telegram
      const message = await this.bot.telegram.sendPhoto(
        adminChannelId,
        { source: file.buffer },
        {
          caption: `🔄 <b>Processing WebApp Deposit...</b>\n\nUser: ${telegramId}\nAmount: ${amount}`,
          parse_mode: 'HTML',
        },
      );

      const fileId = message.photo[message.photo.length - 1].file_id;

      // 2. Save to DB
      const deposit = await this.walletService.createDepositFromWebApp({
        telegramId,
        amount: Number(amount),
        method,
        proofFileId: fileId,
      });

      // 3. Update Admin Message with Action Buttons
      await this.bot.telegram.editMessageCaption(
        adminChannelId,
        message.message_id,
        undefined,
        `🌐 <b>New WebApp Deposit Request</b>\n` +
          `➖➖➖➖➖➖➖➖➖➖\n` +
          `👤 User: <b>${deposit.user.firstName}</b>\n` +
          `💰 Amount: <b>${Number(amount).toLocaleString()} MMK</b>\n` +
          `💳 Method: <b>${method}</b>\n` +
          `#Deposit_${deposit.id}`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '✅ Approve',
                  callback_data: `approve_deposit_${deposit.id}`,
                },
                {
                  text: '❌ Reject',
                  callback_data: `reject_deposit_${deposit.id}`,
                },
              ],
            ],
          },
        },
      );

      return { success: true };
    } catch (error) {
      console.error('Deposit Error:', error);
      throw new InternalServerErrorException('Failed to process deposit');
    }
  }
}
