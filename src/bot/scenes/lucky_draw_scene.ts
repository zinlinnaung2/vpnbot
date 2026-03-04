import { Wizard, WizardStep, Context, Message, Action } from 'nestjs-telegraf';
import { LuckyDrawService } from 'src/lucky-draw/lucky-draw.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Markup } from 'telegraf';
import axios from 'axios';

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
      Markup.keyboard([['🚫 မဝယ်တော့ပါ (Cancel)']]).resize(),
    );
    return ctx.wizard.next();
  }

  @WizardStep(2)
  async step2(@Context() ctx: any, @Message('text') msg: string) {
    if (msg === '🚫 မဝယ်တော့ပါ (Cancel)') return ctx.scene.leave();

    // Basic validation to ensure it's a number
    if (isNaN(Number(msg))) {
      await ctx.reply(
        '❌ Player ID သည် ဂဏန်းများသာ ဖြစ်ရပါမည်။ ပြန်ရိုက်ပေးပါ -',
      );
      return; // Stay on this step until valid input
    }

    ctx.wizard.state.playerId = msg;
    await ctx.reply('🌐 Server ID ကို ရိုက်ထည့်ပေးပါ (ဥပမာ - 1234) -');
    return ctx.wizard.next();
  }

  @WizardStep(3)
  async step3(@Context() ctx: any, @Message('text') msg: string) {
    if (msg === '🚫 မဝယ်တော့ပါ (Cancel)') return ctx.scene.leave();
    ctx.wizard.state.serverId = msg;

    const { playerId, serverId } = ctx.wizard.state;
    const loading = await ctx.reply('⏳ အကောင့်အမည် စစ်ဆေးနေပါသည်...');

    try {
      const res = await axios.get(
        `https://cekidml.caliph.dev/api/validasi?id=${playerId}&serverid=${serverId}`,
        { timeout: 8000 },
      );

      await ctx.telegram
        .deleteMessage(ctx.chat.id, loading.message_id)
        .catch(() => {});

      if (res.data.status === 'success' && res.data.result?.nickname) {
        const nickname = res.data.result.nickname;
        ctx.wizard.state.accName = nickname;

        await ctx.reply(
          `👤 <b>အကောင့်အမည်တွေ့ရှိချက်:</b>\n\n` +
            `အမည်: <b>${nickname}</b>\n` +
            `ID: ${playerId} (${serverId})\n\n` +
            `ဤအကောင့်ဖြင့် ကံစမ်းမှာ မှန်ကန်ပါသလား?`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '✅ မှန်ကန်သည်၊ စာရင်းသွင်းမည်',
                  'confirm_lucky_draw',
                ),
              ],
              [
                Markup.button.callback(
                  '❌ မှားနေသည်၊ ပြန်ရိုက်မည်',
                  'restart_lucky_input',
                ),
              ],
            ]),
          },
        );
      } else {
        // Validation Failed: Re-request Player ID directly
        await ctx.reply(
          '❌ ID/Server ရှာမတွေ့ပါ။ Player ID ကို ပြန်လည်စစ်ဆေးပြီး ရိုက်ထည့်ပေးပါ -',
        );
        return ctx.wizard.selectStep(0);
      }
    } catch (e) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, loading.message_id)
        .catch(() => {});

      // Connection Error: Forced choices (Retype or Exit)
      await ctx.reply(
        '⚠️ အကောင့်စစ်ဆေး၍မရပါ။ ID ကို ပြန်လည်စစ်ဆေးပြီး ရိုက်ထည့်ပေးပါ -',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 ပြန်ရိုက်မည်', 'restart_lucky_input')],
          [Markup.button.callback('🚫 ထွက်မည်', 'exit_lucky_draw')],
        ]),
      );
    }
  }

  @Action('confirm_lucky_draw')
  async onConfirm(@Context() ctx: any) {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    return this.finalRegistration(ctx);
  }

  @Action('restart_lucky_input')
  async onRestart(@Context() ctx: any) {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    // Jump to step 0 so step1()'s logic handles the "one-time" request
    return ctx.wizard.selectStep(0);
  }

  @Action('exit_lucky_draw')
  async onExit(@Context() ctx: any) {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply('🚫 ကံစမ်းမဲအစီအစဉ်မှ ထွက်လိုက်ပါပြီ။');
    return ctx.scene.leave();
  }

  async finalRegistration(ctx: any) {
    const { playerId, serverId, accName } = ctx.wizard.state;
    const telegramId = ctx.from.id;

    try {
      const user = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      const existing = await this.prisma.luckyDrawParticipant.findUnique({
        where: { userId: user.id },
      });

      if (existing) {
        await ctx.reply('⚠️ လူကြီးမင်းသည် စာရင်းသွင်းပြီးသားဖြစ်ပါသည်။');
        return ctx.scene.leave();
      }

      const count = await this.prisma.luckyDrawParticipant.count();
      if (count >= 100) {
        await ctx.reply(
          '❌ စိတ်မကောင်းပါဘူး၊ ကံစမ်းမဲအယောက် ၁၀၀ ပြည့်သွားပါပြီ။',
        );
        return ctx.scene.leave();
      }

      const ticketId = `TKT-${Math.floor(1000 + Math.random() * 9000)}`;

      await this.prisma.luckyDrawParticipant.create({
        data: {
          userId: user.id,
          playerId,
          serverId,
          accName,
          ticketId,
        },
      });

      await ctx.reply(
        `✅ စာရင်းသွင်းမှု အောင်မြင်ပါသည်!\n🎫 သင်၏ Ticket ID: <b>${ticketId}</b>\n\nအယောက် ၁၀၀ ပြည့်ပါက Lucky Draw အလိုအလျောက် စတင်ပါမည်။`,
        { parse_mode: 'HTML' },
      );

      if (count + 1 >= 100) {
        await ctx.reply(
          '🎊 ဂုဏ်ယူပါတယ်! အယောက် ၁၀၀ ပြည့်သွားပြီဖြစ်တဲ့အတွက် Lucky Draw ကို အခုပဲ စတင်ပါတော့မယ်။',
        );
        this.luckyDrawService.startDraw();
      }

      return ctx.scene.leave();
    } catch (err) {
      console.error(err);
      await ctx.reply('❌ မှတ်တမ်းတင်ရာတွင် အမှားအယွင်းရှိခဲ့ပါသည်။');
      return ctx.scene.leave();
    }
  }
}
