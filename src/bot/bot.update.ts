import {
  Update,
  Ctx,
  Start,
  Action,
  Command,
  InjectBot,
  Hears,
  On,
  Context,
} from 'nestjs-telegraf';
import { Telegraf, Markup } from 'telegraf';
import { UsersService } from '../users/users.service';
import { ProductsService } from '../products/products.service';
import { WalletService } from '../wallet/wallet.service';
import { UseFilters } from '@nestjs/common';
import { TelegrafExceptionFilter } from '../common/filters/telegraf-exception.filter';
import { BotContext } from 'src/interfaces/bot-context.interface';
import { PrismaService } from '../prisma/prisma.service';
import { LuckyDrawService } from 'src/lucky-draw/lucky-draw.service';

export const MAIN_KEYBOARD = Markup.keyboard([
  ['🎟️ MLBB Lucky Draw', '🎁 ဆုလာဘ်ထုတ်ယူရန်'],
  ['🛒 စျေးဝယ်မယ်', '📝 စျေးဝယ်မှတ်တမ်း'], // ခလုတ်အသစ်ထည့်လိုက်သည်
  ['💰 လက်ကျန်ငွေ', '➕ ငွေဖြည့်မယ်'],
  ['💸 ငွေထုတ်မယ်', '👥 ဖိတ်ခေါ်မယ်'],
  ['🎮 ဂိမ်းကစားမယ်', '📞 အကူအညီ'],
]).resize();
export const GAME_KEYBOARD = Markup.keyboard([
  ['🎰 2D ထိုးမယ်', '🎲 3D ထိုးမယ်'],
  ['🎲 အနိမ့်/အမြင့်', '📝 ထိုးမှတ်တမ်း'],
  ['🏠 ပင်မစာမျက်နှာ'], // To go back to main menu
]).resize();

@Update()
@UseFilters(TelegrafExceptionFilter)
export class BotUpdate {
  private readonly CHANNEL_ID = '-1002052753323';
  private readonly CHANNEL_USERNAME = 'movie_box_mm';
  private readonly BONUS_AMOUNT = 1000;
  constructor(
    @InjectBot() private readonly bot: Telegraf<BotContext>,
    private readonly usersService: UsersService,
    private readonly productsService: ProductsService,
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
    private readonly drawService: LuckyDrawService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: BotContext) {
    const telegramId = Number(ctx.from.id);
    const text = (ctx.message as any)?.text || '';
    const payload = text.split(' ')[1]; // Extracts "ref_123456789" from "/start ref_123456789"

    // [NEW] Referral Logic: Check if the user is completely new BEFORE creating them
    const isNewUser =
      (await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      })) === null;

    if (isNewUser && payload && payload.startsWith('ref_')) {
      const referrerTelegramId = Number(payload.replace('ref_', ''));

      // Prevent users from referring themselves
      if (referrerTelegramId !== telegramId) {
        const referrer = await this.prisma.user.findUnique({
          where: { telegramId: BigInt(referrerTelegramId) },
        });

        if (referrer) {
          // 1. Give the referrer 100 MMK
          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: referrer.id },
              data: { balance: { increment: 100 } },
            }),
            this.prisma.transaction.create({
              data: {
                userId: referrer.id,
                amount: 100,
                type: 'DEPOSIT', // Kept as DEPOSIT to match your DB schema
                description: `🎁 Referral Bonus for inviting ${ctx.from.first_name}`,
              },
            }),
          ]);

          // 2. Notify the referrer that they got money
          try {
            await this.bot.telegram.sendMessage(
              referrerTelegramId,
              `🎉 <b>Referral အောင်မြင်ပါသည်!</b>\n\nမိတ်ဆွေ၏ Link မှတဆင့် <b>${ctx.from.first_name}</b> ဝင်ရောက်လာတဲ့အတွက် အပိုဆု <b>100 MMK</b> ကို Balance ထဲသို့ ထည့်သွင်းပေးလိုက်ပါတယ်။`,
              { parse_mode: 'HTML' },
            );
          } catch (e) {
            // Ignore if the referrer has blocked the bot
          }
        }
      }
    }

    // Now proceed with normal creation
    const user = await this.usersService.findOrCreateUser(
      telegramId,
      ctx.from.first_name,
      ctx.from.username,
    );

    // ၁။ Bonus မယူရသေးသူများကို အရင်စစ်မယ်
    if (!user.welcomeBonusClaimed) {
      const firstwelcomeText = `👋 <b>Welcome ${user.firstName}!</b>\n\n`;
      const welcomeText =
        `🎁 လူကြီးမင်းအတွက် အထူးလက်ဆောင်ရှိပါတယ်!\n` +
        `ကျွန်ုပ်တို့၏ Channel ကို Join ထားရုံဖြင့် <b>${this.BONUS_AMOUNT} MMK</b> ကို Bonus အဖြစ် အခမဲ့ ရယူနိုင်ပါတယ်။\n\n` +
        `အောက်ပါ Channel ကို Join ပြီးနောက် "Bonus ယူမည်" ခလုတ်ကို နှိပ်ပေးပါခင်ဗျာ။`;

      await ctx.reply(firstwelcomeText, {
        parse_mode: 'HTML',
        ...MAIN_KEYBOARD,
      });
      await ctx.reply(welcomeText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.url(
              '📢 Channel ကို Join ရန်',
              `https://t.me/${this.CHANNEL_USERNAME}`,
            ),
          ],
          [
            Markup.button.callback(
              '✅ Join ပြီးပါပြီ (Bonus ယူမည်)',
              'verify_bonus',
            ),
          ],
        ]),
      });
      return;
    }

    // ၂။ Bonus ယူပြီးသားသူဆိုရင် ပုံမှန်အတိုင်း ပြမယ်
    const welcomeText = `👋 <b>Welcome back ${user.firstName}!</b>\n\n💰 လက်ရှိလက်ကျန်ငွေ: <b>${user.balance} MMK</b>`;
    await ctx.reply(welcomeText, {
      parse_mode: 'HTML',
      ...MAIN_KEYBOARD,
    });
  }

  @Action('verify_bonus')
  async onVerifyBonus(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from.id;

    try {
      // ၁။ Channel ထဲမှာ တကယ်ရှိမရှိ စစ်ဆေးခြင်း
      const chatMember = await ctx.telegram.getChatMember(
        this.CHANNEL_ID,
        telegramId,
      );
      const isMember = ['member', 'administrator', 'creator'].includes(
        chatMember.status,
      );

      if (!isMember) {
        return await ctx.answerCbQuery(
          '⚠️ လူကြီးမင်း Channel ကို Join ရန် လိုအပ်နေပါသေးတယ်ခင်ဗျာ။',
          { show_alert: true },
        );
      }

      // ၂။ DB မှာ Bonus အခြေအနေကို တစ်ခါပြန်စစ်မယ် (Double Check)
      const user = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (user.welcomeBonusClaimed) {
        return await ctx.answerCbQuery(
          '❌ သင်သည် Bonus ထုတ်ယူပြီးသား ဖြစ်ပါသည်။',
          { show_alert: true },
        );
      }

      // ၃။ ပိုက်ဆံဖြည့်ပေးခြင်းနှင့် Flag မှတ်သားခြင်း
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { telegramId: BigInt(telegramId) },
          data: {
            balance: { increment: this.BONUS_AMOUNT },
            welcomeBonusClaimed: true,
          },
        }),
        this.prisma.transaction.create({
          data: {
            userId: user.id,
            amount: this.BONUS_AMOUNT,
            type: 'DEPOSIT',
            description: '🎁 Welcome Bonus (Join Channel)',
          },
        }),
      ]);

      // ၄။ အောင်မြင်ကြောင်း အကြောင်းကြားစာ
      await ctx.deleteMessage(); // Join ခိုင်းတဲ့ message ကို ဖျက်မယ်
      await ctx.reply(
        `🎉 <b>ဂုဏ်ယူပါတယ်!</b>\n\nChannel Join တဲ့အတွက် လက်ဆောင် <b>${this.BONUS_AMOUNT} MMK</b> ကို လူကြီးမင်းအကောင့်ထဲ ထည့်သွင်းပေးလိုက်ပါပြီ။`,
        {
          parse_mode: 'HTML',
          ...MAIN_KEYBOARD,
        },
      );

      await ctx.answerCbQuery('Bonus Claimed Successfully!');
    } catch (error) {
      console.error('Verify Bonus Error:', error);
      await ctx.answerCbQuery(
        'ခေတ္တခဏ အမှားအယွင်းရှိနေပါသည်။ နောက်မှ ထပ်မံကြိုးစားပေးပါ။',
      );
    }
  }

  // @On('channel_post')
  // async onChannelPost(@Ctx() ctx: any) {
  //   console.log('---------------------------------');
  //   console.log('📢 Channel Post Detected!');
  //   console.log('🆔 Channel ID:', ctx.chat.id);
  //   console.log('💬 Message Text:', ctx.channelPost.text);
  //   console.log('---------------------------------');
  // }

  // @On('message')
  // async onMessage(@Ctx() ctx: any) {
  //   console.log('Chat ID is:', ctx.chat.id); // ဒီကောင်က Channel ID ကို ထုတ်ပြပေးမှာပါ
  // }

  @Action('🎟️ MLBB Lucky Draw')
  async onLuckyDrawAction(@Ctx() ctx: BotContext) {
    // Callback query ကို answer လုပ်ပေးရပါတယ် (Telegram မှာ နာရီပတ်နေတာ ပျောက်သွားအောင်)
    await ctx.answerCbQuery();
    await this.onLuckyDraw(ctx);
  }

  @Hears('🎟️ MLBB Lucky Draw')
  async onLuckyDraw(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from.id;

    // ၁။ လူဦးရေ ၁၀၀ ပြည့်မပြည့် အပြင်ကနေ ကြိုစစ်မယ်
    const count = await this.prisma.luckyDrawParticipant.count();

    if (count >= 100) {
      return await ctx.reply(
        '❌ စိတ်မကောင်းပါဘူး၊ ယခုတစ်ပတ်အတွက် ကံစမ်းမဲအယောက် 100 ပြည့်သွားပါပြီ။\nနောက်တစ်ပတ်တွင် ပြန်လည်ပါဝင်ပေးပါခင်ဗျာ။',
      );
    }

    // ၂။ User က ပါဝင်ပြီးသားလား စစ်မယ်
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: { luckyDrawParticipation: true },
    });

    if (user?.luckyDrawParticipation) {
      await ctx.reply(
        `🎫 လူကြီးမင်း စာရင်းသွင်းထားပြီးဖြစ်ပါတယ်။\nသင်၏ Ticket ID မှာ <b>${user.luckyDrawParticipation.ticketId}</b> ဖြစ်ပါတယ်။`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    // ၃။ Lucky Draw အကြောင်း ရှင်းပြချက် Message
    const infoMessage =
      `🎁 <b>MLBB Weekly Lucky Draw အစီအစဉ်</b>\n\n` +
      `ဒီအပတ်အတွက် ပေးအပ်မည့်ဆုလာဘ်များ -\n` +
      `• 💎 <b>1049 Diamonds</b> (၁ ဆု)\n` +
      `• 🎟 <b>Weekly Diamond Pass</b> (၂ ဆု)\n` +
      `• 💎 <b>11 Diamonds</b> (၁၀ ဆု)\n\n` +
      `📝 <b>စည်းကမ်းချက်များ</b>\n` +
      `- ကံစမ်းမဲကို လူဦးရေ ၁၀၀ အထိသာ လက်ခံပါမည်။\n` +
      `- လူဦးရေပြည့်သည်နှင့် ကံထူးရှင်များကို Bot မှ Auto ဖောက်ပေးသွားမည်။\n` +
      `- Player ID / Server ID မှန်ကန်စွာ ဖြည့်သွင်းရပါမည်။\n\n` +
      `👇 ကံစမ်းရန် အောက်ပါ Button ကို နှိပ်ပြီး အချက်အလက်ဖြည့်သွင်းပါ။`;

    await ctx.reply(infoMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '✅ အခုပဲ ပါဝင်ကံစမ်းမယ်',
              callback_data: 'start_lucky_draw',
            },
          ],
        ],
      },
    });
  }

  async startDraw() {
    try {
      // 1. အချက်အလက်များ ဆွဲထုတ်ခြင်း
      const participants = await this.prisma.luckyDrawParticipant.findMany({
        include: { user: true },
      });

      if (participants.length === 0) return;

      const predefinedWinners = await this.prisma.predefinedWinner.findMany();

      // 2. Logic အသစ်: Rigged ထားတဲ့သူတွေကို Random နှိုက်မယ့် pool ထဲကနေ ကြိုဖယ်ထုတ်ထားမယ်
      // ဒါမှ သူတို့အတွက် သတ်မှတ်ထားတဲ့ ဆုအလှည့်မရောက်မချင်း Random နဲ့ မတော်တဆ မပေါက်မှာ ဖြစ်ပါတယ်။
      let randomPool = participants.filter((p) => {
        return !predefinedWinners.some(
          (rig) => BigInt(rig.telegramId) === BigInt(p.user.telegramId),
        );
      });

      // Rigged စာရင်းကို Clone လုပ်ထားမယ်
      let rigPool = [...predefinedWinners];
      const winnersList = [];

      // 3. ဆုများ သတ်မှတ်ချက်
      const prizes = [
        { name: '1st Prize 1049 Dia', key: '1049_DIA', count: 1 },
        { name: '2nd Prize Weekly Pass', key: 'WEEKLY_PASS', count: 2 },
        { name: '3rd Prize 11 Dia', key: '11_DIA', count: 10 },
      ];

      // 4. Drawing Logic
      for (const p of prizes) {
        for (let i = 0; i < p.count; i++) {
          let winner = null;

          // A. RIGGED LOGIC
          // လက်ရှိ ပတ်နေတဲ့ Prize Key (e.g., 1049_DIA) နဲ့ ကိုက်ညီတဲ့ Rigged winner ရှိမရှိ စစ်မယ်
          const rigIndex = rigPool.findIndex((rp) => rp.prizeType === p.key);

          if (rigIndex !== -1) {
            const targetRig = rigPool[rigIndex];

            // Participants အားလုံးထဲကနေ အဲ့ဒီ Rigged ဖြစ်တဲ့သူကို ရှာမယ်
            const participantIndex = participants.findIndex(
              (part) =>
                BigInt(part.user.telegramId) === BigInt(targetRig.telegramId),
            );

            if (participantIndex !== -1) {
              winner = participants[participantIndex];
              // Instructions ထဲကနေ ဖယ်ထုတ်မယ် (တစ်ခါပဲ ပေါက်စေချင်လို့)
              rigPool.splice(rigIndex, 1);
            }
          }

          // B. RANDOM LOGIC
          // အကယ်၍ Rigged winner မရှိဘူးဆိုရင် (သို့မဟုတ်) ရွေးပြီးသွားပြီဆိုရင် RandomPool ထဲက နှိုက်မယ်
          if (!winner && randomPool.length > 0) {
            const randomIdx = Math.floor(Math.random() * randomPool.length);
            winner = randomPool.splice(randomIdx, 1)[0];
          }

          // C. Database တွင် အနိုင်ရသူအဖြစ် Update လုပ်ခြင်း
          if (winner) {
            winnersList.push({ ...winner, prizeName: p.name });

            await this.prisma.luckyDrawParticipant.update({
              where: { id: winner.id },
              data: {
                isWinner: true,
                prize: p.name,
              },
            });
          }
        }
      }

      // 5. ရလဒ်စာသား ပြင်ဆင်ခြင်း
      let summaryMsg = `🎉 <b>Lucky Draw Results (အယောက် ၁၀၀ ပြည့်)</b> 🎉\n`;
      summaryMsg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

      if (winnersList.length === 0) {
        summaryMsg += `ပါဝင်သူ မရှိသေးပါ။`;
      } else {
        winnersList.forEach((w, index) => {
          summaryMsg += `${index + 1}. ${w.prizeName} -> <b>${w.accName}</b>\n`;
        });
      }

      summaryMsg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      summaryMsg += `🎊 ကံထူးရှင်များအားလုံး ဂုဏ်ယူပါတယ်ခင်ဗျာ။`;

      // 6. ပါဝင်သူအားလုံးကို ရလဒ်များ Broadcast လုပ်ခြင်း
      await Promise.allSettled(
        participants.map(async (p) => {
          try {
            await this.bot.telegram.sendMessage(
              Number(p.user.telegramId),
              summaryMsg,
              {
                parse_mode: 'HTML',
                ...MAIN_KEYBOARD,
              },
            );
          } catch (e: any) {
            console.error(`Failed to send to ${p.user.telegramId}:`, e.message);
          }
        }),
      );
    } catch (error) {
      console.error('Critical Error in startDraw:', error);
    }
  }

  @Action('admin_start_lucky_draw')
  async onAdminStartDraw(@Context() ctx: any) {
    // Admin ဟုတ်မဟုတ် စစ်ဆေးခြင်း
    if (String(ctx.from.id) !== process.env.ADMIN_ID) {
      return ctx.answerCbQuery('❌ သင်သည် Admin မဟုတ်ပါ။');
    }

    await ctx.answerCbQuery('Lucky Draw စတင်နေပါပြီ...');

    // ခလုတ်ကို ပြန်ဖျက်ခြင်း သို့မဟုတ် စာသားပြောင်းခြင်း
    await ctx.editMessageText(
      '🎊 Lucky Draw ကို စတင်လိုက်ပါပြီ။ ရလဒ်များကို Broadcast လုပ်နေပါသည်။',
      {
        parse_mode: 'HTML',
      },
    );

    return this.drawService.startDraw();
  }

  @Action('start_lucky_draw')
  async onStartLuckyDraw(@Ctx() ctx: BotContext) {
    // 1. Loading icon လေး ပျောက်သွားအောင် answer အရင်လုပ်ပေးရပါမယ်
    await ctx.answerCbQuery();

    // 2. လက်ရှိ message (အညွှန်းစာ) ကို ဖျက်ချင်ရင် ဖျက်လို့ရပါတယ် (Optional)
    await ctx.deleteMessage().catch(() => {});

    // 3. Lucky Draw Wizard Scene ထဲသို့ အသစ်ဝင်ခိုင်းလိုက်မယ်
    try {
      await ctx.scene.enter('lucky_draw_scene');
    } catch (e) {
      console.error('Scene Entry Error:', e);
      await ctx.reply(
        '❌ ခေတ္တချို့ယွင်းချက်ရှိနေပါသည်။ နောက်မှ ထပ်မံကြိုးစားပေးပါ။',
      );
    }
  }

  @Hears('🎁 ဆုလာဘ်ထုတ်ယူရန်')
  async onWithdrawPrize(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from.id;

    try {
      // ၁။ User ရဲ့ Lucky Draw အခြေအနေကို ဆွဲထုတ်မယ်
      const myParticipation = await this.prisma.luckyDrawParticipant.findFirst({
        where: { user: { telegramId: BigInt(telegramId) } },
        include: { user: true },
      });

      // ၂။ ပါဝင်ထားခြင်း မရှိလျှင်
      if (!myParticipation) {
        await ctx.reply(
          '❌ လူကြီးမင်းသည် Lucky Draw တွင် ပါဝင်ထားခြင်း မရှိပါဘူး။',
        );
        return;
      }

      // 🌟 ၃။ ပြင်ဆင်လိုက်သော Condition - Lucky Draw မစတင်ရသေးလျှင်
      // prize အစား isWinner: true (အဓိကဆုပေါက်သူ) ရှိမရှိနဲ့ စစ်ပါမယ်။
      // ဒါမှသာ Manual coupon ပေးထားသူတွေအတွက် Draw မစခင် "မစသေးပါ" လို့ မှန်မှန်ကန်ကန် ပြမှာပါ။
      const mainWinnerExist = await this.prisma.luckyDrawParticipant.findFirst({
        where: {
          isWinner: true,
        },
      });

      if (!mainWinnerExist) {
        // ၁။ လက်ရှိ ပါဝင်သူ အရေအတွက်ကို စစ်ဆေးခြင်း
        const currentCount = await this.prisma.luckyDrawParticipant.count();
        const totalLimit = 100;
        const leftCount = Math.max(0, totalLimit - currentCount);

        // ၂။ Progress Bar ပြုလုပ်ခြင်း
        const progressBarLength = 10;
        const filledLength = Math.round(
          (currentCount / totalLimit) * progressBarLength,
        );
        const progressBar =
          '🟢'.repeat(filledLength) +
          '⚪'.repeat(progressBarLength - filledLength);

        await ctx.reply(
          `⏳ <b>Lucky Draw မစတင်ရသေးပါ</b>\n\n` +
            `လက်ရှိအခြေအနေ: ${progressBar} (${currentCount}%)\n` +
            `✅ ပါဝင်ပြီးသူ: <b>${currentCount}</b> ဦး\n` +
            `🚨 လိုအပ်သေးသူ: <b>${leftCount}</b> ဦး\n\n` +
            `လူဦးရေ <b>${totalLimit}</b> ပြည့်ပါက Admin မှ မဲနှိုက်ပေးမည် ဖြစ်ပါသည်။ မဲနှိုက်ပြီးမှသာ ဆုလာဘ်များကို ထုတ်ယူနိုင်မည် ဖြစ်ပါသည်။ ခေတ္တစောင့်ဆိုင်းပေးပါရန်။`,
          { parse_mode: 'HTML', ...MAIN_KEYBOARD },
        );
        return;
      }

      // ၄။ ကံမထူးခဲ့လျှင် (Draw စတင်ပြီးပြီ၊ ဒါပေမဲ့ ကိုယ်က မပေါက်ဘူးဆိုရင်)
      if (!myParticipation.isWinner) {
        // Loser ဖြစ်သော်လည်း 5% Coupon ရထားကြောင်း အသိပေးချက် ပြောင်းလဲခြင်း
        await ctx.reply(
          `😞 <b>ကံမထူးခဲ့ပါဘူး</b>\n\n` +
            `လူကြီးမင်းသည် ယခုအပတ် Lucky Draw တွင် အဓိကဆုကြီးများ မပေါက်ခဲ့သော်လည်း နှစ်သိမ့်ဆုအဖြစ် <b>5% Discount Coupon</b> ရရှိထားပါတယ်ခင်ဗျာ။\n\n` +
            `🎟 Coupon ID: <code>5OFF-${myParticipation.ticketId}</code>\n` +
            `ဂိမ်းပစ္စည်းများ ဝယ်ယူသည့်အခါ System မှ အလိုအလျောက် ခုနှိမ်ပေးသွားမှာ ဖြစ်ပါသည်။`,
          { parse_mode: 'HTML', ...MAIN_KEYBOARD },
        );
        return;
      }

      // ၅။ ဆုထုတ်ယူပြီးသား ဖြစ်နေလျှင်
      if (myParticipation.isClaimed) {
        await ctx.reply(
          '✅ လူကြီးမင်း ဆုလာဘ်ကို ထုတ်ယူပြီးသား ဖြစ်ပါတယ်ခင်ဗျာ။',
        );
        return;
      }

      // ၆။ တောင်းဆိုမှု (Request) တင်ထားပြီးသားလား စစ်ဆေးခြင်း
      if (myParticipation.isRequested) {
        await ctx.reply(
          `⏳ <b>တောင်းဆိုမှု တင်ထားပြီးပါပြီ</b>\n\n` +
            `လူကြီးမင်း၏ ဆုလာဘ်ထုတ်ယူမှု တောင်းဆိုချက်ကို Admin ထံ ပေးပို့ထားပြီး ဖြစ်ပါသည်။ ခေတ္တစောင့်ဆိုင်းပေးပါရန်။`,
          { parse_mode: 'HTML', ...MAIN_KEYBOARD },
        );
        return;
      }

      // ၇။ Database မှာ Request တင်လိုက်ပြီဖြစ်ကြောင်း အရင် Update လုပ်ပါ
      await this.prisma.luckyDrawParticipant.update({
        where: { id: myParticipation.id },
        data: { isRequested: true },
      });

      // ၈။ Admin Channel သို့ အချက်အလက်များ လှမ်းပို့ခြင်း
      const adminChannelId = process.env.ADMIN_CHANNEL_ID || '-100XXXXXXXXX';
      const adminMessage =
        `🎁 <b>Lucky Draw ဆုလာဘ် တောင်းဆိုမှု (Claim)</b>\n\n` +
        `👤 <b>Telegram အမည်:</b> ${myParticipation.user.firstName}\n` +
        `🎟 <b>Ticket ID:</b> <code>${myParticipation.ticketId}</code>\n` +
        `🏆 <b>ဆုအမျိုးအစား:</b> ${myParticipation.prize}\n\n` +
        `🎮 <b>Game Account Name:</b> ${myParticipation.accName}\n` +
        `🆔 <b>ID:</b> <code>${myParticipation.playerId} (${myParticipation.serverId}) </code> \n`;

      await ctx.telegram.sendMessage(adminChannelId, adminMessage, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '✅ Confirm',
              `confirm_prize_${myParticipation.id}`,
            ),
          ],
        ]),
      });

      // ၉။ User အား အကြောင်းကြားခြင်း
      await ctx.reply(
        `🎉 <b>တောင်းဆိုမှု အောင်မြင်ပါသည်</b>\n\n` +
          `လူကြီးမင်း၏ ဆုလာဘ်တောင်းဆိုမှုကို Admin ထံသို့ ပေးပို့လိုက်ပါပြီ။ Admin မှ စစ်ဆေးပြီးပါက reward များကို ဖြည့်သွင်းပေးသွားမည် ဖြစ်ပါသည်။`,
        { parse_mode: 'HTML', ...MAIN_KEYBOARD },
      );
    } catch (error) {
      console.error('Withdraw Prize Error:', error);
      await ctx.reply('❌ အမှားအယွင်း ရှိနေပါသည်။');
    }
  }

  @Action(/^confirm_prize_(.+)$/)
  async onConfirmPrize(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const participantId = parseInt(ctx.match[1]);

    try {
      // ၁။ Database တွင် Claim လုပ်ပြီးကြောင်း (isClaimed: true) ပြောင်းလဲမှတ်သားခြင်း
      const participation = await this.prisma.luckyDrawParticipant.update({
        where: { id: participantId },
        data: { isClaimed: true },
        include: { user: true }, // User ရဲ့ telegramId ကို သိဖို့ လိုအပ်ပါသည်
      });

      // ၂။ Admin Channel မှ စာကို Update လုပ်ပြီး ခလုတ်ကို ဖျောက်လိုက်ခြင်း (COMPLETED စာတန်းပြောင်းခြင်း)
      const originalText = (ctx.callbackQuery.message as any).text || '';
      await ctx.editMessageText(
        `${originalText}\n\n✅ <b>STATUS: COMPLETED (စိန်ဖြည့်ပေးပြီးပါပြီ - ${ctx.from.first_name})</b>`,
        { parse_mode: 'HTML' },
      );

      // ၃။ ကံထူးရှင် (User) ထံသို့ စိန်ဖြည့်သွင်းပေးပြီးကြောင်း Noti ပေးပို့ခြင်း
      await ctx.telegram.sendMessage(
        Number(participation.user.telegramId),
        `🎉 <b>ဆုလာဘ် ရရှိပါပြီ!</b>\n\n` +
          `လူကြီးမင်း ကံထူးထားသော <b>${participation.prize}</b> ကို Game Account ထဲသို့ အောင်မြင်စွာ ထည့်သွင်းပေးလိုက်ပါပြီခင်ဗျာ။\n` +
          `ကံစမ်းပေးတဲ့အတွက် ကျေးဇူးအထူးတင်ရှိပါတယ်။\n` +
          `<i>Mlbb diamond များဝယ်ယူလိုပါကဈေးဝယ်မည် button နှိပ်ပြီး ဝယ်ယူနိုင်ပါတယ်ခင်ဗျ။ </i>`,
        { parse_mode: 'HTML' },
      );

      // ၄။ Button Loading ပျောက်ရန်
      await ctx.answerCbQuery('ဆုလာဘ် ပေးအပ်ခြင်း အောင်မြင်ပါသည်။');
    } catch (error) {
      console.error('Confirm Prize Error:', error);
      await ctx.answerCbQuery('❌ အမှားအယွင်းဖြစ်ပေါ်နေပါသည်။', {
        show_alert: true,
      });
    }
  }

  @Command('balance')
  @Hears('💰 လက်ကျန်ငွေ')
  async onBalance(@Ctx() ctx: BotContext) {
    const balance = await this.usersService.getBalance(Number(ctx.from.id));
    await ctx.reply(
      `💰 လူကြီးမင်းရဲ့ လက်ရှိလက်ကျန်ငွေကတော့ <b>${balance} MMK </b> ဖြစ်ပါတယ်ခင်ဗျာ။`,
      {
        parse_mode: 'HTML',
      },
    );
  }

  @Hears('📝 စျေးဝယ်မှတ်တမ်း')
  async onPurchaseHistory(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from.id;

    try {
      // ၁။ User ID ကို ရှာမယ်
      const user = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!user) return;

      // ၂။ ဝယ်ယူမှုမှတ်တမ်းကို Service မှတဆင့် ယူမယ်
      const history = await this.productsService.getPurchaseHistory(user.id);

      if (history.length === 0) {
        return await ctx.reply(
          '⚠️ လူကြီးမင်းမှာ ဝယ်ယူထားတဲ့ မှတ်တမ်း မရှိသေးပါဘူးခင်ဗျာ။',
        );
      }

      let message = `📝 <b>လူကြီးမင်း၏ စျေးဝယ်မှတ်တမ်း (နောက်ဆုံး ၁၀ ခု)</b>\n`;
      message += `━━━━━━━━━━━━━━━━━━\n\n`;

      history.forEach((item, index) => {
        const date = new Date(item.createdAt).toLocaleDateString('en-GB');
        const isApi = item.product.type === 'API';
        const keyLabel = isApi ? '🔗 Link' : '🔑 Key';

        message += `${index + 1}. 📦 <b>${item.product.name}</b>\n`;
        message += `💰 ဈေးနှုန်း: ${item.amount} MMK\n`;
        message += `📅 ရက်စွဲ: ${date}\n`;

        // Key သို့မဟုတ် API Link ရှိလျှင် ပြပေးမယ်
        if (item.productKey) {
          message += `${keyLabel}: <code>${item.productKey.key}</code>\n`;
        } else if (item.status === 'PENDING') {
          message += `⏳ အခြေအနေ: <b>စောင့်ဆိုင်းဆဲ (Admin Approve)</b>\n`;
        } else if (item.status === 'REJECTED') {
          message += `❌ အခြေအနေ: <b>ငြင်းပယ်ခံရသည် (Refunded)</b>\n`;
        }

        message += `━━━━━━━━━━━━━━━━━━\n`;
      });

      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Purchase History Error:', error);
      await ctx.reply('❌ မှတ်တမ်းရှာဖွေရာတွင် အမှားအယွင်းရှိနေပါသည်။');
    }
  }

  @Hears('🎮 ဂိမ်းကစားမယ်')
  async onPlayGameMenu(@Ctx() ctx: BotContext) {
    await ctx.reply('🎮 ကစားလိုသည့် ဂိမ်းအမျိုးအစားကို ရွေးချယ်ပေးပါခင်ဗျာ -', {
      ...GAME_KEYBOARD,
    });
  }

  @Hears('👥 ဖိတ်ခေါ်မယ်')
  async onReferral(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from.id;

    // Get the bot's username automatically so the link is always correct
    const botInfo = await ctx.telegram.getMe();
    const refLink = `https://t.me/${botInfo.username}?start=ref_${telegramId}`;

    // Find the user and all their Referral Bonus transactions
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: {
        transactions: {
          where: { description: { startsWith: '🎁 Referral Bonus' } },
        },
      },
    });

    // Calculate totals based on transactions
    const totalReferrals = user?.transactions.length || 0;
    const totalEarned =
      user?.transactions.reduce((sum, t) => sum + Number(t.amount), 0) || 0;

    const refText =
      `👥 <b>မိတ်ဆွေများကို ဖိတ်ခေါ်ပါ။</b>\n\n` +
      `အောက်ပါ Link ကိုအသုံးပြုပြီး သူငယ်ချင်းများကို ဖိတ်ခေါ်ကာ တစ်ဦးလျှင် <b>100 MMK</b> အခမဲ့ ရယူနိုင်ပါတယ်။\n\n` +
      `📊 <b>သင်၏ ဖိတ်ခေါ်မှု မှတ်တမ်း:</b>\n` +
      `• ဖိတ်ခေါ်ထားသူ အရေအတွက်: <b>${totalReferrals}</b> ဦး\n` +
      `• ရရှိထားသော စုစုပေါင်းဆုငွေ: <b>${totalEarned} MMK</b>\n\n` +
      `🔗 <b>သင်၏ ဖိတ်ခေါ်ရန် Link:</b>\n` +
      `<code>${refLink}</code>\n\n` +
      `<i>(အပေါ်က Link လေးကို တစ်ချက်နှိပ်ရုံဖြင့် Copy ကူးယူနိုင်ပါတယ်ခင်ဗျာ)</i>`;

    await ctx.reply(refText, { parse_mode: 'HTML' });
  }

  @Hears('🏠 ပင်မစာမျက်နှာ')
  async onHome(@Ctx() ctx: BotContext) {
    try {
      await ctx.scene.leave();
    } catch (e) {}

    const user = await this.usersService.findOrCreateUser(
      Number(ctx.from.id),
      ctx.from.first_name,
      ctx.from.username,
    );

    await ctx.reply(
      `🏠 <b>ပင်မစာမျက်နှာသို့ ပြန်ရောက်ပါပြီ။</b>\n\n💰 လက်ရှိလက်ကျန်ငွေ: <b>${user.balance} MMK</b>`,
      {
        parse_mode: 'HTML',
        ...MAIN_KEYBOARD, // Show the Main Menu again
      },
    );
  }

  @Hears('🎰 2D ထိုးမယ်')
  async onTwoD(@Ctx() ctx: BotContext) {
    await ctx.scene.enter('scene_2d');
  }

  @Hears('🎲 3D ထိုးမယ်')
  async onThreeD(@Ctx() ctx: BotContext) {
    await ctx.scene.enter('scene_3d');
  }

  @Command('topup')
  @Hears('➕ ငွေဖြည့်မယ်')
  async onTopUp(@Ctx() ctx: BotContext) {
    await ctx.scene.enter('topup_scene');
  }

  @Hears('💸 ငွေထုတ်မယ်')
  async onWithdraw(@Ctx() ctx: BotContext) {
    await ctx.scene.enter('withdraw_scene');
  }

  @Hears('🎲 အနိမ့်/အမြင့်')
  async onHighLow(@Ctx() ctx: BotContext) {
    // Web App ရဲ့ URL (ဥပမာ - https://your-game-app.web.app/high-low)
    // .env ထဲမှာ WEB_APP_URL ဆိုပြီး သိမ်းထားတာ ပိုကောင်းပါတယ်
    const webAppUrl = `https://bot-admin-dashboard.vercel.app/game`;

    await ctx.reply(
      '🎲 <b>High/Low Game (အနိမ့်/အမြင့်)</b>\n\n' +
        'ကံစမ်းရန်အတွက် အောက်ပါ <b>Play Game</b> ခလုတ်ကို နှိပ်ပြီးကစားနိုင်ပါပြီခင်ဗျာ။',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            // 💡 ဤနေရာတွင် Web App ခလုတ်ကို ထည့်သွင်းထားသည်
            Markup.button.webApp('🎮 Play Game (ကစားမည်)', webAppUrl),
          ],
          [Markup.button.callback('🏠 ပင်မစာမျက်နှာ', 'go_main')],
        ]),
      },
    );
  }

  // BotUpdate class ရဲ့ အောက်နားတစ်နေရာမှာ ထည့်ပါ
  @Action('go_main')
  async onGoMainAction(@Ctx() ctx: BotContext) {
    // ၁။ လက်ရှိ Inline Keyboard ပါတဲ့ message ကို ဖျက်လိုက်မယ် (Optionally)
    try {
      await ctx.deleteMessage();
    } catch (e) {
      // message ဖျက်မရရင် ignore လုပ်မယ်
    }

    // ၂။ ပင်မစာမျက်နှာကို ပြန်ပို့မယ် (onHome function ကို ပြန်ခေါ်သလိုမျိုး)
    const user = await this.usersService.findOrCreateUser(
      Number(ctx.from.id),
      ctx.from.first_name,
      ctx.from.username,
    );

    await ctx.reply(
      `🏠 <b>ပင်မစာမျက်နှာသို့ ပြန်ရောက်ပါပြီ။</b>\n\n💰 လက်ရှိလက်ကျန်ငွေ: <b>${user.balance} MMK</b>`,
      {
        parse_mode: 'HTML',
        ...MAIN_KEYBOARD,
      },
    );

    // ၃။ Loading icon လေး ပျောက်သွားအောင် answer ပေးရပါမယ်
    await ctx.answerCbQuery();
  }

  // src/bot/bot.update.ts

  @Hears('📝 ထိုးမှတ်တမ်း')
  async onHistory(@Ctx() ctx: BotContext) {
    const telegramId = BigInt(ctx.from.id);

    try {
      // Database မှ ထိုးထားသော မှတ်တမ်းများ ရှာခြင်း
      const user = await this.prisma.user.findUnique({
        where: { telegramId },
        include: {
          bets: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!user || !user.bets || user.bets.length === 0) {
        return await ctx.reply('⚠️ သင်ထိုးထားတဲ့ မှတ်တမ်း မရှိသေးပါဘူးခင်ဗျာ။');
      }

      let historyMessage = `📝 <b>သင်၏ နောက်ဆုံးထိုးမှတ်တမ်း (၁၀) ခု</b>\n`;
      historyMessage += `━━━━━━━━━━━━━━━━━━\n`;

      user.bets.forEach((bet, index) => {
        const date = new Date(bet.createdAt).toLocaleString('en-US', {
          timeZone: 'Asia/Yangon',
          hour12: true, // AM/PM ထည့်ရန်
        });
        const statusEmoji =
          bet.status === 'WIN' ? '✅' : bet.status === 'LOSE' ? '❌' : '⏳';
        const statusText =
          bet.status === 'WIN'
            ? 'ပေါက်'
            : bet.status === 'LOSE'
              ? 'မပေါက်'
              : 'စောင့်ဆိုင်းဆဲ';

        historyMessage += `${index + 1}. 🎯 <b>${bet.number}</b> ${statusEmoji} (${statusText})\n (${bet.type})\n`;
        historyMessage += `   💰 ${Number(bet.amount)} MMK | 🕒 ${date}\n`;
        historyMessage += `━━━━━━━━━━━━━━━━━━\n`;
      });

      await ctx.reply(historyMessage, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('History Error:', error);
      await ctx.reply('❌ မှတ်တမ်းရှာဖွေရာတွင် အမှားအယွင်းရှိနေပါသည်။');
    }
  }

  // src/bot/bot.update.ts

  @Command('result')
  async onResult(@Ctx() ctx: BotContext) {
    // ၁။ Admin ဟုတ်မဟုတ် စစ်ဆေးခြင်း
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    const [, type, winNumber] = (ctx.message as any).text.split(' '); // e.g., /result 2D 84

    if (!type || !winNumber) {
      return ctx.reply('⚠️ အသုံးပြုပုံ - /result [2D/3D] [ဂဏန်း]');
    }

    // ၂။ လက်ရှိ Session ကို သတ်မှတ်ခြင်း (မနက် သို့မဟုတ် ညနေ)
    const session = new Date().getHours() < 13 ? 'MORNING' : 'EVENING';

    // ၃။ ထိုးထားသမျှ PENDING ဖြစ်နေသော Bet များကို ရှာခြင်း
    const bets = await this.prisma.bet.findMany({
      where: {
        type,
        session,
        status: 'PENDING',
      },
      include: { user: true },
    });

    let winCount = 0;

    for (const bet of bets) {
      if (bet.number === winNumber) {
        // ✅ ပေါက်သောသူများ (Win Logic)
        const winAmount = Number(bet.amount) * (type === '2D' ? 8 : 80); // 2D=80 ဆ၊ 3D=500 ဆ

        await this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: bet.userId },
            data: { balance: { increment: winAmount } },
          }),
          this.prisma.bet.update({
            where: { id: bet.id },
            data: { status: 'WIN' },
          }),
        ]);

        // User ထံသို့ အကြောင်းကြားစာပို့ခြင်း
        await this.bot.telegram.sendMessage(
          Number(bet.user.telegramId),
          `🎉 <b>ဂုဏ်ယူပါတယ်!</b>\n\nလူကြီးမင်းထိုးထားသော <b>${bet.number}</b> ဂဏန်း ပေါက်ပါသည်။\n💰 အနိုင်ရငွေ: <b>${winAmount} MMK</b> ကို လက်ကျန်ငွေထဲ ပေါင်းထည့်ပေးလိုက်ပါပြီ။`,
          { parse_mode: 'HTML' },
        );
        winCount++;
      } else {
        // ❌ မပေါက်သောသူများ (Lose Logic)
        await this.prisma.bet.update({
          where: { id: bet.id },
          data: { status: 'LOSE' },
        });

        await this.bot.telegram.sendMessage(
          Number(bet.user.telegramId),
          `😞 စိတ်မကောင်းပါဘူးခင်ဗျာ။\nယနေ့ထွက်ဂဏန်းမှာ <b>${winNumber}</b> ဖြစ်ပြီး လူကြီးမင်းထိုးထားသော <b>${bet.number}</b> မပေါက်ပါ။\nနောက်တစ်ကြိမ် ပြန်လည်ကံစမ်းပေးပါဦး။`,
          { parse_mode: 'HTML' },
        );
      }
    }

    await ctx.reply(
      `📊 Result ထုတ်ပြန်ပြီးပါပြီ \n\nဂဏန်း: ${winNumber}\nပေါက်သူစုစုပေါင်း: ${winCount} ဦး`,
    );
  }

  // --- Shop Flow ---

  // --- Shop Flow (Modified for Subcategories) ---

  @Action('🛒 စျေးဝယ်မယ်')
  @Hears('🛒 စျေးဝယ်မယ်')
  @Action('shop_main')
  async onShop(@Ctx() ctx: BotContext) {
    const categories = await this.productsService.getCategories();

    if (categories.length === 0) {
      await ctx.reply(
        'လက်ရှိမှာ ဝယ်ယူလို့ရနိုင်တဲ့ ပစ္စည်း မရှိသေးပါဘူးခင်ဗျာ။',
      );
      return;
    }

    const buttons = categories.map((c) => [
      Markup.button.callback(c, `cat_${c}`),
    ]);

    const text = '📂 အမျိုးအစား တစ်ခု ရွေးချယ်ပေးပါခင်ဗျာ';

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
    } else {
      await ctx.reply(text, Markup.inlineKeyboard(buttons));
    }
  }

  // ၁။ Category ကိုနှိပ်လိုက်ရင် Subcategory များကို ပြပေးမည့် Logic
  @Action(/^cat_(.+)$/)
  async onCategorySelect(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const category = ctx.match[1];
    const subCategories = await this.productsService.getSubCategories(category);

    // အကယ်၍ Subcategory မရှိရင် Product တန်းပြမယ် (Backward compatibility)
    if (subCategories.length === 0) {
      const products =
        await this.productsService.getProductsByCategory(category);
      return this.renderProductList(ctx, products, category, 'shop_main');
    }

    const buttons = subCategories.map((sc) => [
      Markup.button.callback(sc, `sub_${category}_${sc}`),
    ]);

    buttons.push([
      Markup.button.callback('🔙 ပင်မအမျိုးအစားသို့', 'shop_main'),
    ]);

    await ctx.editMessageText(
      `📂 <b>${category}</b> အောက်ရှိ အမျိုးအစားခွဲများ -`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      },
    );
  }

  // ၂။ Subcategory ကိုနှိပ်လိုက်ရင် သက်ဆိုင်ရာ Product များကို ပြပေးမည့် Logic
  @Action(/^sub_(.+)_(.+)$/)
  async onSubCategorySelect(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const category = ctx.match[1];
    // @ts-ignore
    const subCategory = ctx.match[2];

    const products = await this.productsService.getProductsBySubCategory(
      category,
      subCategory,
    );

    // Back button အတွက် Category menu ကို ပြန်ညွှန်းမယ်
    return this.renderProductList(
      ctx,
      products,
      subCategory,
      `cat_${category}`,
    );
  }

  // Product List များကို ဆွဲထုတ်ပေးမည့် Helper Function
  private async renderProductList(
    ctx: BotContext,
    products: any[],
    title: string,
    backAction: string,
  ) {
    const buttons = products.map((p) => [
      Markup.button.callback(`${p.name} - ${p.price} MMK`, `prod_${p.id}`),
    ]);

    buttons.push([Markup.button.callback('🔙 နောက်သို့', backAction)]);

    await ctx.editMessageText(
      `🛒 <b>${title}</b>\n\nဝယ်ယူလိုသည့် ပစ္စည်းကို ရွေးချယ်ပေးပါခင်ဗျာ -`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      },
    );
  }

  @Action(/^prod_(.+)$/)
  async onProductSelect(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const productId = parseInt(ctx.match[1]);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) return ctx.answerCbQuery('Product not found.');

    // MANUAL PRODUCT (GAME TOPUP) ဖြစ်လျှင် Scene ထဲဝင်မယ်
    if (product.type === 'MANUAL') {
      await ctx.deleteMessage();
      // @ts-ignore
      await ctx.scene.enter('game_purchase_scene', { productId });
      return;
    }

    // AUTO သို့မဟုတ် API PRODUCT များအတွက် အတည်ပြုချက်တောင်းမယ်
    // Back button အတွက် Subcategory ရှိလျှင် ပြန်ညွှန်းရန် logic
    const backBtn = product.subCategory
      ? `sub_${product.category}_${product.subCategory}`
      : `cat_${product.category}`;

    await ctx.editMessageText(
      `❓ <b>ဝယ်ယူရန် အတည်ပြုချက်</b>\n\n📦 ပစ္စည်း: <b>${product.name}</b>\n💰 ဈေးနှုန်း: <b>${product.price} MMK</b>\n\nဝယ်ယူရန် သေချာပါသလား?`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ ဝယ်ယူမည်', `buy_${productId}`)],
          [Markup.button.callback('❌ မဝယ်တော့ပါ', backBtn)],
        ]),
      },
    );
  }

  // @Action(/^cat_(.+)$/)
  // async onCategorySelect(@Ctx() ctx: BotContext) {
  //   // @ts-ignore
  //   const category = ctx.match[1];
  //   const products = await this.productsService.getProductsByCategory(category);

  //   const buttons = products.map((p) => [
  //     Markup.button.callback(`${p.name} - ${p.price} MMK`, `prod_${p.id}`),
  //   ]);
  //   buttons.push([
  //     Markup.button.callback('🔙 Back to Categories', 'shop_main'),
  //   ]);

  //   await ctx.editMessageText(
  //     `📂 အမျိုးအစား - ${category}\n\nအသေးစိတ်ကြည့်ရှုရန်အတွက် ပစ္စည်းတစ်ခုခုကို ရွေးချယ်ပေးပါခင်ဗျာ -`,
  //     {
  //       parse_mode: 'Markdown',
  //       ...Markup.inlineKeyboard(buttons),
  //     },
  //   );
  // }

  // @Action(/^prod_(.+)$/)
  // async onProductSelect(@Ctx() ctx: BotContext) {
  //   // @ts-ignore
  //   const productId = parseInt(ctx.match[1]);

  //   const product = await this.prisma.product.findUnique({
  //     where: { id: productId },
  //   });

  //   // CHECK IF MANUAL (GAME) OR AUTO (KEY)
  //   if (product.type === 'MANUAL') {
  //     // Enter the Scene for MLBB/PUBG
  //     await ctx.deleteMessage(); // Clean up menu
  //     // @ts-ignore
  //     await ctx.scene.enter('game_purchase_scene', { productId });
  //     return;
  //   }

  //   // EXISTING LOGIC FOR KEYS/AUTO
  //   await ctx.editMessageText(
  //     `❓ ဤပစ္စည်းကို ဝယ်ယူရန် သေချာပါသလား?\n\n📦 ${product.name}\n💰 ${product.price} MMK`,
  //     Markup.inlineKeyboard([
  //       [Markup.button.callback('✅ ဝယ်ယူရန် အတည်ပြုသည်', `buy_${productId}`)],
  //       [Markup.button.callback('❌ မဝယ်တော့ပါ', 'shop_main')],
  //     ]),
  //   );
  // }

  // ------------------------------------------
  // 2. ADD THESE NEW ADMIN ACTIONS
  // ------------------------------------------

  // ============================================================
  // အပိုင်း (က) - Direct Pay (Screenshot) အတွက် သီးသန့် Logic
  // (ဒီအပိုင်းမှာ ငွေပြန်အမ်းတဲ့ Refund logic လုံးဝမပါပါ)
  // ============================================================

  @Action(/^direct_done_(.+)$/)
  async onDirectDone(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const purchaseId = parseInt(ctx.match[1]);

    try {
      // 1. Fetch the purchase details FIRST without updating status
      const purchase = await this.prisma.purchase.findUnique({
        where: { id: purchaseId },
        include: { user: true, product: true },
      });

      if (!purchase) return ctx.answerCbQuery('Purchase not found');

      const category = purchase.product.category?.toUpperCase().trim() || '';
      const name = purchase.product.name.toUpperCase();

      // --- FEATURE: GIFTCARD / VPN HANDLER ---
      if (category === 'GIFTCARD' || name.includes('VPN')) {
        await ctx.answerCbQuery();

        // IMPORTANT: Remove the inline buttons from the Admin message first.
        // This clears the interaction state and prevents the 400 error.
        const caption = (ctx.callbackQuery.message as any).caption || '';
        await ctx.editMessageCaption(
          `${caption}\n\n⏳ <b>Processing... Admin ${ctx.from.first_name} is entering the code.</b>`,
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }, // Clears the keyboard
          },
        );

        // Enter the scene to collect the code
        return await ctx.scene.enter('admin_gift_code_scene', { purchaseId });
      }

      // --- ORIGINAL LOGIC: REGULAR PRODUCTS ---
      const updatedPurchase = await this.prisma.purchase.update({
        where: { id: purchaseId },
        data: { status: 'COMPLETED' },
        include: { user: true, product: true },
      });

      const caption = (ctx.callbackQuery.message as any).caption || '';
      await ctx.editMessageCaption(
        `${caption}\n\n✅ <b>COMPLETED BY ${ctx.from.first_name.toUpperCase()}</b>`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        },
      );

      const userMsg =
        `✅ <b>အော်ဒါ အောင်မြင်ပါသည်!</b>\n\n` +
        `📦 ပစ္စည်း: <b>${updatedPurchase.product.name}</b>\n` +
        `🔢 အရေအတွက်: <b>${updatedPurchase.quantity}</b>\n` +
        `💰 စုစုပေါင်းကျသင့်ငွေ: <b>${updatedPurchase.amount.toLocaleString()} MMK</b>\n\n` +
        `လူကြီးမင်း၏ အကောင့်ထဲသို့ ပစ္စည်းများ ထည့်သွင်းပေးလိုက်ပါပြီ။\nကျေးဇူးတင်ပါသည်! 🙏`;

      await ctx.telegram.sendMessage(
        Number(updatedPurchase.user.telegramId),
        userMsg,
        { parse_mode: 'HTML' },
      );

      await ctx.answerCbQuery('Order Completed!');
    } catch (e) {
      console.error('Action Error:', e);
      await ctx.answerCbQuery('Error updating order');
    }
  }

  @Action(/^direct_reject_(.+)$/)
  async onDirectReject(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const purchaseId = parseInt(ctx.match[1]);

    try {
      const purchase = await this.prisma.purchase.update({
        where: { id: purchaseId },
        data: { status: 'REJECTED' },
        include: { user: true, product: true },
      });

      // Admin Message Update
      const caption = (ctx.callbackQuery.message as any).caption || '';
      await ctx.editMessageCaption(
        `${caption}\n\n❌ <b>REJECTED BY ${ctx.from.first_name.toUpperCase()}</b>`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }, // Button တွေကို ဖျက်လိုက်တာ
        },
      );

      // User ဆီ ငြင်းပယ်ကြောင်း ပို့မယ်
      const rejectMsg =
        `❌ <b>အော်ဒါကို ငြင်းပယ်လိုက်ပါသည်</b>\n\n` +
        `📦 ပစ္စည်း: ${purchase.product.name} (${purchase.quantity} ခု)\n\n` +
        `လူကြီးမင်း ပေးပို့ထားသော ငွေလွှဲပြေစာ သို့မဟုတ် အချက်အလက်များ မှားယွင်းနေသဖြင့် Admin မှ ပယ်ဖျက်လိုက်ပါသည်။\n` +
        `အဆင်မပြေမှုရှိပါက Admin ကို ပြန်လည်ဆက်သွယ်ပေးပါ။`;

      await ctx.telegram.sendMessage(
        Number(purchase.user.telegramId),
        rejectMsg,
        { parse_mode: 'HTML' },
      );

      await ctx.answerCbQuery('Order Rejected');
    } catch (e) {
      console.error(e);
      await ctx.answerCbQuery('Error rejecting order');
    }
  }

  @Action(/^order_done_(.+)$/)
  async onOrderDone(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const purchaseId = parseInt(ctx.match[1]);

    try {
      const purchase = await this.prisma.purchase.update({
        where: { id: purchaseId },
        data: { status: 'COMPLETED' },
        include: { user: true, product: true },
      });

      // Update Admin Message
      const originalText = (ctx.callbackQuery.message as any).text;
      await ctx.editMessageText(
        `${originalText}\n\n✅ <b>COMPLETED by ${ctx.from.first_name}</b>`,
        { parse_mode: 'HTML' },
      );

      // Notify User
      await ctx.telegram.sendMessage(
        Number(purchase.user.telegramId),
        `✅ <b>Successful!</b>\n\nလူကြီးမင်း ဝယ်ယူထားသော <b>${purchase.product.name}</b> ကို ဂိမ်းအကောင့်ထဲသို့ ထည့်သွင်းပေးလိုက်ပါပြီ။`,
        { parse_mode: 'HTML' },
      );

      await ctx.answerCbQuery('Marked as Done');
    } catch (e) {
      console.error(e);
      await ctx.answerCbQuery('Error updating order');
    }
  }

  @Action(/^order_reject_(.+)$/)
  async onOrderReject(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const purchaseId = parseInt(ctx.match[1]);

    try {
      const purchase = await this.prisma.purchase.findUnique({
        where: { id: purchaseId },
      });

      if (purchase.status !== 'PENDING')
        return ctx.answerCbQuery('Already processed');

      // Refund and Reject Transaction
      await this.prisma.$transaction([
        this.prisma.purchase.update({
          where: { id: purchaseId },
          data: { status: 'REJECTED' },
        }),
        this.prisma.user.update({
          where: { id: purchase.userId },
          data: { balance: { increment: purchase.amount } },
        }),
        this.prisma.transaction.create({
          data: {
            userId: purchase.userId,
            amount: purchase.amount,
            type: 'REFUND',
            description: `Order Refund: ${purchaseId}`,
          },
        }),
      ]);

      // Update Admin Message
      const originalText = (ctx.callbackQuery.message as any).text;
      await ctx.editMessageText(
        `${originalText}\n\n❌ <b>REJECTED & REFUNDED by ${ctx.from.first_name}</b>`,
        { parse_mode: 'HTML' },
      );

      // Notify User
      const user = await this.prisma.user.findUnique({
        where: { id: purchase.userId },
      });
      await ctx.telegram.sendMessage(
        Number(user.telegramId),
        `❌ <b>Order Cancelled</b>\n\nလူကြီးမင်း၏ Order ကို Admin မှ ပယ်ဖျက်လိုက်ပါသည်။\nငွေ ${purchase.amount} MMK ကို Balance ထဲသို့ ပြန်ထည့်ပေးထားပါသည်။`,
        { parse_mode: 'HTML' },
      );

      await ctx.answerCbQuery('Order Rejected & Refunded');
    } catch (e) {
      console.error(e);
      await ctx.answerCbQuery('Error rejecting order');
    }
  }

  @Action(/^buy_(.+)$/)
  async onBuyConfirm(@Ctx() ctx: BotContext) {
    // @ts-ignore
    const productId = parseInt(ctx.match[1]);
    const userId = ctx.from.id;

    const dbUser = await this.usersService.findOrCreateUser(
      Number(userId),
      ctx.from.first_name,
    );

    try {
      // ProductsService မှ purchaseProduct ကို ခေါ်ယူခြင်း
      const result = await this.productsService.purchaseProduct(
        dbUser.id,
        productId,
      );

      await ctx.deleteMessage();

      // ပစ္စည်းအမျိုးအစားအလိုက် စာသားခွဲခြားသတ်မှတ်ခြင်း
      const isApi = result.type === 'API';
      const keyLabel = isApi ? '🔗 Subscription Link' : '🔑 Product Key';
      const noteText = isApi
        ? `<i>(အပေါ်က Link ကို Copy ကူးပြီး ${result.product.subCategory} App ထဲတွင် Add လုပ်နိုင်ပါသည်)</i>`
        : '<i>(Key ကို တစ်ချက်နှိပ်ရုံဖြင့် Copy ကူးယူနိုင်ပါသည်)</i>';

      const successText =
        `✅ <b>ဝယ်ယူမှု အောင်မြင်ပါသည်!</b>\n\n` +
        `📦 <b>ဝယ်ယူသည့်ပစ္စည်း:</b> ${result.product.name}\n\n` +
        `<b>${keyLabel}:</b>\n` +
        `<code>${result.key}</code>\n\n` +
        `${noteText}\n\n` +
        `<i>မှတ်ချက်။ ။ ဝယ်ယူထားသော မှတ်တမ်းကို "စျေးဝယ်မှတ်တမ်း"  တွင် ပြန်လည်ကြည့်ရှုနိုင်ပါသည်။</i>`;

      await ctx.reply(successText, {
        parse_mode: 'HTML',
        ...MAIN_KEYBOARD, // ပင်မ Menu ပြန်ပြပေးမယ်
      });
    } catch (error: any) {
      // Error ဖြစ်ရင် Alert ထိုးပြမယ်
      await ctx.answerCbQuery(error.message, { show_alert: true });

      // balance မလုံလောက်ရင် ငွေဖြည့်ခိုင်းတဲ့ ခလုတ်ပြပေးလို့ရတယ်
      if (error.message.includes('မလုံလောက်')) {
        await ctx.reply(
          '❌ လက်ကျန်ငွေ မလုံလောက်ပါသဖြင့် ငွေအရင်ဖြည့်ပေးပါခင်ဗျာ။',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('➕ ငွေဖြည့်မယ်', 'topup_scene')],
            ]),
          },
        );
      }
    }
  }

  // --- Admin Actions ---

  @Action(/^approve_deposit_(.+)$/)
  async onApproveDeposit(@Ctx() ctx: BotContext) {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    // @ts-ignore
    const depositId = parseInt(ctx.match[1]);
    try {
      // WalletService MUST use 'include: { user: true }' in its internal prisma call
      const deposit = await this.walletService.approveDeposit(
        depositId,
        ctx.from.id,
      );

      // 1. Update Admin UI
      const originalCaption = (ctx.callbackQuery.message as any).caption || '';
      await ctx.editMessageCaption(
        `${originalCaption}\n\n✅ <b>STATUS: APPROVED</b>`,
        { parse_mode: 'HTML' },
      );

      // 2. Notify User
      // We access .user.telegramId because we fixed the WalletService Prisma call
      const userTelegramId = Number(deposit.user.telegramId);

      await this.bot.telegram.sendMessage(
        userTelegramId,
        `✅ <b>ငွေဖြည့်သွင်းမှု အောင်မြင်သွားပါပြီ!</b>\n\n${deposit.amount}MMK ကိုလက်ကျန်ငွေထဲသို့ ပေါင်းထည့်ပေးပြီးပါပြီခင်ဗျာ။`,
        { parse_mode: 'HTML' },
      );

      await ctx.answerCbQuery('ငွေဖြည့်သွင်းမှု အောင်မြင်သွားပါပြီ');
    } catch (e: any) {
      await ctx.reply('Error: ' + e.message);
    }
  }

  @Action(/^reject_deposit_(.+)$/)
  async onRejectDeposit(@Ctx() ctx: BotContext) {
    // 1. Security Check
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    // @ts-ignore
    const depositId = parseInt(ctx.match[1]);

    try {
      // 2. Reject in DB and get user info
      // WalletService.rejectDeposit MUST return the user object (include: { user: true })
      const deposit = await this.walletService.rejectDeposit(depositId);

      // 3. Update Admin UI (Remove buttons and show status)
      const originalCaption = (ctx.callbackQuery.message as any).caption || '';
      await ctx.editMessageCaption(
        `${originalCaption}\n\n❌ <b>STATUS: REJECTED</b>`,
        { parse_mode: 'HTML' },
      );

      // 4. Send Message to the User
      const userTelegramId = Number(deposit.user.telegramId);
      await this.bot.telegram.sendMessage(
        userTelegramId,
        `❌ <b>Deposit Rejected</b>\n\nစိတ်မကောင်းပါဘူးခင်ဗျာ၊ လူကြီးမင်း ပေးပို့ထားတဲ့ ${deposit.amount} MMK ငွေဖြည့်သွင်းမှုကို အက်ဒမင် (Admin) က လက်မခံပါဘူး။ တစ်စုံတစ်ရာ မှားယွင်းမှု ရှိနေတယ်လို့ ထင်မြင်ပါက အကူအညီ (Support)ဆီကို ဆက်သွယ်ပေးပါခင်ဗျာ`,
        { parse_mode: 'HTML' },
      );

      await ctx.answerCbQuery('User notified of rejection.');
    } catch (e: any) {
      await ctx.reply('Error: ' + e.message);
    }
  }

  @Action('topup_scene')
  async onTopUpAction(@Ctx() ctx: BotContext) {
    // ၁။ Loading icon လေး ပျောက်သွားအောင် answer ပေးပါ
    await ctx.answerCbQuery();

    // ၂။ လက်ရှိ message ကို ဖျက်ချင်ရင် ဖျက်နိုင်ပါတယ် (Optional)
    try {
      await ctx.deleteMessage();
    } catch (e) {}

    // ၃။ Scene ထဲကို အတင်းဝင်ခိုင်းပါ
    await ctx.scene.enter('topup_scene');
  }

  @Hears('📞 အကူအညီ')
  async onSupport(@Ctx() ctx: BotContext) {
    const supportText =
      `📞 <b>အကူအညီ လိုအပ်ပါသလား?</b>\n\n` +
      `နည်းပညာပိုင်းဆိုင်ရာ အခက်အခဲများ သို့မဟုတ် သိရှိလိုသည်များကို အောက်ပါ Admin ဆီမှာ တိုက်ရိုက် မေးမြန်းနိုင်ပါတယ်ခင်ဗျာ။\n\n` +
      `👤 <b>Contact:</b> @Prototype004905`;

    await ctx.reply(supportText, { parse_mode: 'HTML' });
  }

  @On('text')
  async onUnknownText(@Ctx() ctx: BotContext) {
    try {
      // လက်ရှိ ဝင်နေတဲ့ Scene တွေရှိရင် အတင်းထွက်ခိုင်းပါမယ် (Clean up)
      await ctx.scene.leave();
    } catch (e) {
      // Scene ထဲမှာ မရှိရင်လည် ပြဿနာမရှိပါ
    }

    const user = await this.usersService.findOrCreateUser(
      Number(ctx.from.id),
      ctx.from.first_name,
      ctx.from.username,
    );

    // ပင်မစာမျက်နှာ (Main Menu) ကို Keyboard အသစ်နဲ့တကွ ပြန်ပို့ပေးပါမယ်
    await ctx.reply(
      `⚠️ <b>ချိတ်ဆက်မှု အချိန်ကြာမြင့်သွားပါသည်။</b>\n\n` +
        `စနစ်ပိုင်း လုံခြုံရေးအရ ပင်မစာမျက်နှာသို့ ပြန်လည်ရောက်ရှိသွားပါပြီ။ ကျေးဇူးပြု၍ အောက်ပါ မီနူးမှတဆင့် ပြန်လည်ရွေးချယ်ပေးပါခင်ဗျာ။\n\n` +
        `💰 လက်ရှိလက်ကျန်ငွေ: <b>${user.balance} MMK</b>`,
      {
        parse_mode: 'HTML',
        ...MAIN_KEYBOARD,
      },
    );
  }

  // --- Withdraw Admin Actions ---

  @Action(/^approve_withdraw_(.+)$/)
  async onApproveWithdraw(@Ctx() ctx: BotContext) {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    // @ts-ignore
    const withdrawId = parseInt(ctx.match[1]);

    try {
      const withdraw = await this.prisma.withdraw.update({
        where: { id: withdrawId },
        data: { status: 'APPROVED' },
        include: { user: true },
      });

      // Admin UI Update
      const originalText = (ctx.callbackQuery.message as any).text || '';
      await ctx.editMessageText(
        `${originalText}\n\n✅ <b>STATUS: APPROVED (ငွေလွှဲပြီး)</b>`,
        { parse_mode: 'HTML' },
      );

      // User ထံ Notification ပို့ခြင်း
      await this.bot.telegram.sendMessage(
        Number(withdraw.user.telegramId),
        `✅ <b>ငွေထုတ်ယူမှု အောင်မြင်ပါသည်!</b>\n\nလူကြီးမင်း ထုတ်ယူထားသော ${withdraw.amount} MMK ကို ${withdraw.method} (${withdraw.phoneNumber}) သို့ လွှဲပြောင်းပေးပြီးပါပြီ။`,
        { parse_mode: 'HTML' },
      );

      await ctx.answerCbQuery('Withdrawal Approved');
    } catch (e: any) {
      await ctx.reply('Error: ' + e.message);
    }
  }

  @Action(/^reject_withdraw_(.+)$/)
  async onRejectWithdraw(@Ctx() ctx: BotContext) {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    // @ts-ignore
    const withdrawId = parseInt(ctx.match[1]);

    try {
      // Transaction သုံးပြီး Status ပြောင်းမယ်၊ ပိုက်ဆံကို Refund ပြန်ပေးမယ်
      const withdraw = await this.prisma.withdraw.findUnique({
        where: { id: withdrawId },
        include: { user: true },
      });

      if (!withdraw || withdraw.status !== 'PENDING') {
        return ctx.answerCbQuery('ဤတောင်းဆိုမှုသည် သက်တမ်းကုန်ဆုံးသွားပါပြီ။');
      }

      await this.prisma.$transaction([
        // ၁။ User ဆီ ပိုက်ဆံပြန်ပေါင်းပေးခြင်း
        this.prisma.user.update({
          where: { id: withdraw.userId },
          data: { balance: { increment: withdraw.amount } },
        }),
        // ၂။ Status ကို Reject ပြောင်းခြင်း
        this.prisma.withdraw.update({
          where: { id: withdrawId },
          data: { status: 'REJECTED' },
        }),

        this.prisma.transaction.create({
          data: {
            userId: withdraw.userId,
            amount: withdraw.amount,
            type: 'REFUND',
            description: `ငွေထုတ်ယူမှု ပယ်ဖျက်ခြင်း (Refund) - #${withdrawId}`,
          },
        }),
      ]);

      // Admin UI Update
      const originalText = (ctx.callbackQuery.message as any).text || '';
      await ctx.editMessageText(
        `${originalText}\n\n❌ <b>STATUS: REJECTED (ငြင်းပယ်လိုက်သည်)</b>`,
        { parse_mode: 'HTML' },
      );

      // User ထံ Notification ပို့ခြင်း
      await this.bot.telegram.sendMessage(
        Number(withdraw.user.telegramId),
        `❌ <b>ငွေထုတ်ယူမှု ငြင်းပယ်ခံရသည်</b>\n\nလူကြီးမင်း၏ ${withdraw.amount} MMK ထုတ်ယူမှုကို Admin မှ ငြင်းပယ်လိုက်ပါသည်။ နှုတ်ယူထားသော ပိုက်ဆံကို လူကြီးမင်း၏ Balance ထဲသို့ ပြန်လည် ထည့်သွင်းပေးလိုက်ပါပြီ။`,
        { parse_mode: 'HTML' },
      );

      await ctx.answerCbQuery('Withdrawal Rejected & Refunded');
    } catch (e: any) {
      await ctx.reply('Error: ' + e.message);
    }
  }
}
