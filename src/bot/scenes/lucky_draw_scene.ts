import { Wizard, WizardStep, Context, On, Message } from 'nestjs-telegraf';
import { LuckyDrawService } from 'src/lucky-draw/lucky-draw.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Markup } from 'telegraf';

@Wizard('lucky_draw_scene')
export class LuckyDrawWizard {
  constructor(
    private prisma: PrismaService,
    private luckyDrawService: LuckyDrawService,
  ) {}

  @WizardStep(1)
  async step1(@Context() ctx: any) {
    await ctx.reply(
      '🎮 Lucky Draw ပါဝင်ရန် လူကြီးမင်း၏ MLBB Player ID ကို ရိုက်ထည့်ပေးပါ -',
    );
    ctx.wizard.next();
  }

  @WizardStep(2)
  async step2(@Context() ctx: any, @Message('text') msg: string) {
    ctx.wizard.state.playerId = msg;
    await ctx.reply('🌐 Server ID ကို ရိုက်ထည့်ပေးပါ (ဥပမာ - 1234) -');
    ctx.wizard.next();
  }

  @WizardStep(3)
  async step3(@Context() ctx: any, @Message('text') msg: string) {
    ctx.wizard.state.serverId = msg;

    // အကောင့်စစ်ဆေးခြင်း (ဒီနေရာမှာ API နဲ့ စစ်လို့ရသလို၊ Manual ပဲ အတည်ပြုခိုင်းလို့ရပါတယ်)
    const { playerId, serverId } = ctx.wizard.state;
    await ctx.reply(
      `🔍 အချက်အလက်များကို စစ်ဆေးပေးပါ\n\nPlayer ID: ${playerId}\nServer ID: ${serverId}\n\nမှန်ကန်ပါက အကောင့်အမည်ကို ရိုက်ထည့်ပေးပါ -`,
    );
    ctx.wizard.next();
  }

  @WizardStep(4)
  async step4(@Context() ctx: any, @Message('text') accName: string) {
    const telegramId = ctx.from.id;
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });

    // ၁။ လက်ရှိ Participant Count ကို စစ်မယ်
    const count = await this.prisma.luckyDrawParticipant.count();

    if (count >= 200) {
      await ctx.reply(
        '❌ စိတ်မကောင်းပါဘူး၊ ကံစမ်းမဲအယောက် ၂၀၀ ပြည့်သွားပါပြီ။',
      );
      return ctx.scene.leave();
    }

    // ၂။ Ticket ဖန်တီးပြီး Save မယ်
    const ticketId = `TKT-${Math.floor(1000 + Math.random() * 9000)}`;
    await this.prisma.luckyDrawParticipant.create({
      data: {
        userId: user.id,
        playerId: ctx.wizard.state.playerId,
        serverId: ctx.wizard.state.serverId,
        accName: accName,
        ticketId: ticketId,
      },
    });

    await ctx.reply(
      `✅ စာရင်းသွင်းမှု အောင်မြင်ပါသည်!\n🎫 သင်၏ Ticket ID: <b>${ticketId}</b>\n\nအယောက် ၂၀၀ ပြည့်ပါက Lucky Draw အလိုအလျောက် စတင်ပါမည်။`,
      { parse_mode: 'HTML' },
    );

    // ၃။ အခုလူနဲ့ပေါင်းမှ ၂၀၀ ပြည့်တာဆိုရင် Draw စတင်မယ်
    if (count + 1 >= 200) {
      await ctx.reply(
        '🎊 ဂုဏ်ယူပါတယ်! အယောက် ၂၀၀ ပြည့်သွားပြီဖြစ်တဲ့အတွက် Lucky Draw ကို အခုပဲ စတင်ပါတော့မယ်။',
      );

      // Async ခေါ်လိုက်ပြီး Scene ထဲက ထွက်မယ် (နောက်ကွယ်မှာ Draw လုပ်နေလိမ့်မယ်)
      this.luckyDrawService.startDraw();
    }

    return ctx.scene.leave();
  }
}
