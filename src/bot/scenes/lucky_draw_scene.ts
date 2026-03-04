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

    if (isNaN(Number(msg))) {
      await ctx.reply(
        '❌ Player ID သည် ဂဏန်းများသာ ဖြစ်ရပါမည်။ ပြန်ရိုက်ပေးပါ -',
      );
      return;
    }

    ctx.wizard.state.playerId = msg;

    await ctx.reply(
      '🌐 Server ID ကို ရိုက်ထည့်ပေးပါ (ဥပမာ - 1234) -',
      Markup.keyboard([['🚫 မဝယ်တော့ပါ (Cancel)']]).resize(),
    );

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
        await ctx.reply(
          '❌ ID/Server ရှာမတွေ့ပါ။ ID မှန်ကန်အောင် ပြန်လည်ရိုက်ထည့်ပေးပါ -',
        );
        return ctx.wizard.selectStep(0);
      }
    } catch (e) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, loading.message_id)
        .catch(() => {});
      await ctx.reply(
        '⚠️ အကောင့်စစ်ဆေး၍မရပါ။ ပြန်လည်စစ်ဆေးပြီး ရိုက်ထည့်ပါ -',
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '🔄 ပြန်လည်ကြိုးစားမည်',
              'restart_lucky_input',
            ),
          ],
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
    ctx.wizard.selectStep(0);
    return this.step1(ctx);
  }

  @Action('exit_lucky_draw')
  async onExit(@Context() ctx: any) {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(
      '🚫 ကံစမ်းမဲအစီအစဉ်မှ ထွက်လိုက်ပါပြီ။',
      Markup.removeKeyboard(),
    );
    return ctx.scene.leave();
  }

  // --- ADMIN ACTION HANDLER ---
  @Action('admin_start_lucky_draw')
  async onAdminStartDraw(@Context() ctx: any) {
    await ctx.answerCbQuery('Lucky Draw စတင်နေပါပြီ...');
    await ctx.editMessageCaption('🎊 Lucky Draw ကို စတင်လိုက်ပါပြီ။');
    return this.luckyDrawService.startDraw();
  }

  async finalRegistration(ctx: any) {
    const { playerId, serverId, accName } = ctx.wizard.state;
    const telegramId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;

    try {
      const user = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      const existing = await this.prisma.luckyDrawParticipant.findUnique({
        where: { userId: user.id },
      });

      if (existing) {
        await ctx.reply(
          '⚠️ လူကြီးမင်းသည် စာရင်းသွင်းပြီးသားဖြစ်ပါသည်။',
          Markup.removeKeyboard(),
        );
        return ctx.scene.leave();
      }

      const count = await this.prisma.luckyDrawParticipant.count();
      if (count >= 100) {
        await ctx.reply(
          '❌ စိတ်မကောင်းပါဘူး၊ လူဦးရေ ၁၀၀ ပြည့်သွားပါပြီ။',
          Markup.removeKeyboard(),
        );
        return ctx.scene.leave();
      }

      const ticketId = `TKT-${Math.floor(1000 + Math.random() * 9000)}`;

      await this.prisma.luckyDrawParticipant.create({
        data: { userId: user.id, playerId, serverId, accName, ticketId },
      });

      // User Confirmation
      await ctx.reply(
        `✅ စာရင်းသွင်းမှု အောင်မြင်ပါသည်!\n🎫 သင်၏ Ticket ID: <b>${ticketId}</b>\n\nအယောက် ၁၀၀ ပြည့်ပါက Admin မှ Lucky Draw စတင်ပေးပါမည်။`,
        { parse_mode: 'HTML', ...Markup.removeKeyboard() },
      );

      // --- NOTIFY ADMIN WHEN 100 IS REACHED ---
      const newCount = count + 1;
      if (newCount >= 100) {
        const adminMsg =
          `📢 <b>Lucky Draw Participant ပြည့်သွားပါပြီ!</b>\n\n` +
          `စုစုပေါင်း: <b>${newCount} / 100</b>\n` +
          `နောက်ဆုံးစာရင်းသွင်းသူ: <b>${accName}</b>\n` +
          `User: <a href="tg://user?id=${telegramId}">${username}</a>\n\n` +
          `Lucky Draw စတင်ရန် အောက်က Button ကို နှိပ်ပါ -`;

        // Send to Admin Channel/ID
        await ctx.telegram.sendMessage(process.env.ADMIN_ID, adminMsg, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '🚀 Start Lucky Draw Now',
                'admin_start_lucky_draw',
              ),
            ],
          ]),
        });
      }

      return ctx.scene.leave();
    } catch (err) {
      console.error(err);
      await ctx.reply('❌ အမှားအယွင်းရှိခဲ့ပါသည်။', Markup.removeKeyboard());
      return ctx.scene.leave();
    }
  }
}
