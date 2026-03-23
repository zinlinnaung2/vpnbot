import { Wizard, WizardStep, Context, On } from 'nestjs-telegraf';
import { Scenes, Markup } from 'telegraf';
import { WalletService } from '../../wallet/wallet.service';
import { UsersService } from '../../users/users.service';
import { MAIN_KEYBOARD } from '../bot.update'; // Ensure MAIN_KEYBOARD is exported from bot.update
import { PrismaService } from 'src/prisma/prisma.service';

interface WizardContext extends Scenes.WizardContext {
  wizard: {
    state: {
      amount?: number;
      userId?: number;
    };
  } & Scenes.WizardContext['wizard'];
}

@Wizard('topup_scene')
export class TopUpScene {
  constructor(
    private walletService: WalletService,
    private userService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  // ============================================================
  // STEP 1: ပမာဏ မေးမြန်းခြင်း
  // ============================================================
  @WizardStep(1)
  async askAmount(@Context() ctx: WizardContext) {
    // 1. Setting ကို Database ထဲက အရင်ရှာမယ်
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'isTopUpOpen' },
    });

    // 2. ပိတ်ထားရင် (value က 'false' ဖြစ်နေရင်) အသိပေးစာပို့ပြီး ထွက်မယ်
    if (setting && setting.value === 'false') {
      await ctx.reply(
        '⚠️ <b>ခေတ္တပိတ်ထားပါသည်။</b>\n\n' +
          'လက်ရှိတွင် ငွေဖြည့်သွင်းခြင်း (Top-Up) ကို ခေတ္တပိတ်ထားပါသည်ခင်ဗျာ။\n' +
          'ခေတ္တစောင့်ဆိုင်းပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။ 🙏',
        { parse_mode: 'HTML', ...MAIN_KEYBOARD },
      );
      return ctx.scene.leave();
    }

    // 3. ဖွင့်ထားရင် ပုံမှန်အတိုင်း ဆက်သွားမယ်
    await ctx.reply(
      '💰 <b>ငွေဖြည့်သွင်းခြင်း (Top-Up)</b>\n\n' +
        'ငွေဖြည့်သွင်းလိုသည့် ပမာဏကို ရိုက်ထည့်ပေးပါခင်ဗျာ။\n' +
        '(အနည်းဆုံး <b>3,000 MMK</b> ဖြစ်ရပါမည်။)\n\n' +
        '<i>ဥပမာ - 5000 ဟု ရိုက်ထည့်ပါ။</i>',
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([['❌ မလုပ်တော့ပါ']]).resize(),
      },
    );
    ctx.wizard.next();
  }

  // ============================================================
  // STEP 2: ပမာဏ စစ်ဆေးခြင်းနှင့် ငွေလွှဲအကောင့် ပြသခြင်း
  // ============================================================
  @WizardStep(2)
  @On('text')
  async onAmount(@Context() ctx: WizardContext) {
    const message = ctx.message as any;
    const text = message?.text?.trim();

    // 1. လုပ်ဆောင်ချက်ကို ဖျက်သိမ်းခြင်း
    if (text === '❌ မလုပ်တော့ပါ' || text.toLowerCase() === 'cancel') {
      await ctx.reply('✅ လုပ်ဆောင်မှုကို ဖျက်သိမ်းလိုက်ပါပြီ။', {
        parse_mode: 'HTML',
        ...MAIN_KEYBOARD, // Keyboard ပြန်ပေါ်ရန်
      });
      return ctx.scene.leave();
    }

    const amount = parseInt(text);

    // 2. ပမာဏ မှန်/မမှန် စစ်ဆေးခြင်း
    if (isNaN(amount) || amount < 3000 || amount % 10 !== 0) {
      await ctx.reply(
        '⚠️ <b>ပမာဏ မှားယွင်းနေပါသည်။</b>\n\n' +
          'ကျေးဇူးပြု၍ အနည်းဆုံး <b>3,000</b> ကျပ်မှစ၍ ရိုက်ထည့်ပေးပါ။\n' +
          '(ဂဏန်းအဆုံးသည် 0 ဖြစ်ရပါမည်။)\n\n' +
          'ပြန်လည်ရိုက်ထည့်ပါ -',
        { parse_mode: 'HTML' },
      );
      return; // Step ထဲမှာပဲ ဆက်ရှိနေမည်
    }

    ctx.wizard.state.amount = amount;

    const paymentInfo =
      `🏦 <b>ငွေလွှဲရန် အကောင့်များ</b>\n` +
      `➖➖➖➖➖➖➖➖➖➖\n` +
      `💎 <b>KBZ Pay</b> : <code>09447032756</code>  \n ` +
      `💎 <b>Wave Pay</b> : <code>09447032756</code>  \n` +
      `💎 <b>AYA Pay</b>  : <code>09447032756</code> \n` +
      `Name:<b>Zin Linn Aung</b> \n` +
      `➖➖➖➖➖➖➖➖➖➖\n\n` +
      `သွင်းငွေပမာဏ: <b>${amount.toLocaleString()} MMK</b>\n\n` +
      `အထက်ပါ အကောင့်များထဲမှ တစ်ခုခုသို့ ငွေ ${amount}MMK လွှဲပေးပါခင်ဗျာ။\n` +
      `ငွေလွှဲပြီးပါက <b>ငွေလွှဲပြေစာ (Screenshot)</b> ကို ပေးပို့ပေးပါ။`;

    await ctx.reply(paymentInfo, {
      parse_mode: 'HTML',
      ...Markup.keyboard([['❌ မလုပ်တော့ပါ']]).resize(),
    });

    ctx.wizard.next();
  }

  // ============================================================
  // STEP 3: Screenshot လက်ခံခြင်းနှင့် Admin ထံ ပေးပို့ခြင်း
  // ============================================================
  @WizardStep(3)
  @On('message')
  async onPhoto(@Context() ctx: WizardContext) {
    const msg = ctx.message as any;

    // 1. လုပ်ဆောင်ချက်ကို ဖျက်သိမ်းခြင်း
    if (msg.text === '❌ မလုပ်တော့ပါ' || msg.text?.toLowerCase() === 'cancel') {
      await ctx.reply('✅ လုပ်ဆောင်မှုကို ဖျက်သိမ်းလိုက်ပါပြီ။', {
        parse_mode: 'HTML',
        ...MAIN_KEYBOARD,
      });
      return ctx.scene.leave();
    }

    // 2. ဓာတ်ပုံ ဟုတ်/မဟုတ် စစ်ဆေးခြင်း
    if (!msg.photo || msg.photo.length === 0) {
      await ctx.reply(
        '⚠️ <b>ငွေလွှဲပြေစာ ဓာတ်ပုံ မတွေ့ရှိပါ။</b>\nကျေးဇူးပြု၍ Screenshot ပုံကို ပေးပို့ပေးပါခင်ဗျာ။',
        {
          parse_mode: 'HTML',
        },
      );
      return;
    }

    const userId = ctx.from.id;
    const amount = ctx.wizard.state.amount;
    const loadingMsg = await ctx.reply('⏳ စစ်ဆေးနေပါသည်...');

    try {
      const user = await this.userService.findOrCreateUser(
        userId,
        ctx.from.first_name || 'User',
      );
      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;

      // DB ထဲသို့ သိမ်းဆည်းခြင်း
      const deposit = await this.walletService.createDepositRequest(
        user.id,
        amount,
        fileId,
      );

      // Admin ထံ Notification ပို့ခြင်း
      // const adminId = process.env.ADMIN_ID;

      const channelId = process.env.ADMIN_CHANNEL_ID;

      if (channelId) {
        const adminMsg = await ctx.telegram.sendPhoto(channelId, fileId, {
          caption:
            `🔔 <b>New Deposit Request</b>\n` +
            `➖➖➖➖➖➖➖➖➖➖\n` +
            `👤 User: <b>${ctx.from.first_name}</b>\n` +
            `🆔 ID: <code>${userId}</code>\n` +
            `💰 Amount: <b>${amount.toLocaleString()} MMK</b>\n` +
            `📅 Date: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })}\n` +
            `#Deposit_${deposit.id}`,
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
        });

        await this.prisma.deposit.update({
          where: { id: deposit.id },
          data: { adminMessageId: adminMsg.message_id.toString() },
        });
      }

      await ctx.telegram
        .deleteMessage(ctx.chat.id, loadingMsg.message_id)
        .catch(() => {});

      // 3. အောင်မြင်ကြောင်း User ထံ အကြောင်းကြားခြင်း
      await ctx.reply(
        '✅ <b>ငွေဖြည့်သွင်းမှု တောင်းဆိုချက် အောင်မြင်ပါသည်။</b>\n' +
          'Admin မှ စစ်ဆေးပြီးနောက် အတည်ပြုပေးပါမည်။ 🙏',
        {
          parse_mode: 'HTML',
          ...MAIN_KEYBOARD, // Main Menu Keyboard ပြန်ပေါ်စေရန်
        },
      );

      return ctx.scene.leave();
    } catch (error) {
      console.error(error);
      await ctx.telegram
        .deleteMessage(ctx.chat.id, loadingMsg.message_id)
        .catch(() => {});
      await ctx.reply('❌ စနစ်ချို့ယွင်းချက်ရှိပါသည်၊ Admin ကို ဆက်သွယ်ပါ။', {
        ...MAIN_KEYBOARD,
      });
      return ctx.scene.leave();
    }
  }
}
