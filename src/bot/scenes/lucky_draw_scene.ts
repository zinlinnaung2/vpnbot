import { Wizard, WizardStep, Context, Message, Action } from 'nestjs-telegraf';
import { LuckyDrawService } from 'src/lucky-draw/lucky-draw.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Markup } from 'telegraf';
import axios from 'axios';
import { MAIN_KEYBOARD } from '../bot.update';

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
    await ctx.wizard.next();
    return;
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

    await ctx.wizard.next();
    return;
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

    try {
      // 1. Database ထဲမှာ User ရှိမရှိ အရင်ရှာမယ်
      const user = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!user) {
        await ctx.reply(
          '❌ User record ရှာမတွေ့ပါ။ /start ကို ပြန်နှိပ်ပေးပါ။',
          { ...MAIN_KEYBOARD },
        );
        return ctx.scene.leave();
      }

      // 2. ဒီ Telegram User က စာရင်းသွင်းပြီးသားလား စစ်မယ် (Check by Telegram ID)
      const existingUser = await this.prisma.luckyDrawParticipant.findUnique({
        where: { userId: user.id },
      });

      if (existingUser) {
        await ctx.reply(
          '⚠️ လူကြီးမင်းသည် စာရင်းသွင်းပြီးသားဖြစ်ပါသည်။ တစ်ကြိမ်သာ ပါဝင်ခွင့်ရှိပါသည်။',
          { ...MAIN_KEYBOARD },
        );
        return ctx.scene.leave();
      }

      // 3. ဒီ Game ID + Server ID က စာရင်းသွင်းပြီးသားလား စစ်မယ် (Check by MLBB ID)
      // Telegram အကောင့်အသစ်နဲ့ လာကံစမ်းရင်တောင် ဒီအဆင့်မှာ မိသွားပါလိမ့်မယ်
      const existingGameAcc = await this.prisma.luckyDrawParticipant.findFirst({
        where: {
          playerId: playerId,
          serverId: serverId,
        },
      });

      if (existingGameAcc) {
        await ctx.reply(
          `❌ ဤ Game ID (ID: ${playerId}) သည် အခြား Telegram အကောင့်တစ်ခုဖြင့် စာရင်းသွင်းပြီးသား ဖြစ်နေပါသည်။\n\nမိမိကိုယ်ပိုင် Game ID ဖြင့်သာ ကံစမ်းပေးပါရန်။`,
          { ...MAIN_KEYBOARD },
        );
        return ctx.scene.leave();
      }

      // 4. လူဦးရေ ၁၀၀ ပြည့်မပြည့် စစ်မယ်
      const count = await this.prisma.luckyDrawParticipant.count();
      if (count >= 100) {
        await ctx.reply(
          '❌ စိတ်မကောင်းပါဘူး၊ လူဦးရေ ၁၀၀ ပြည့်သွားပါပြီ။ နောက်တစ်ကြိမ် Lucky Draw ကို စောင့်မျှော်ပေးပါ။',
          { ...MAIN_KEYBOARD },
        );
        return ctx.scene.leave();
      }

      // 5. အားလုံး OK ရင် Ticket ထုတ်ပေးပြီး Database သွင်းမယ်
      const ticketId = `TKT-${Math.floor(1000 + Math.random() * 9000)}`;

      await this.prisma.luckyDrawParticipant.create({
        data: {
          userId: user.id,
          playerId: playerId,
          serverId: serverId,
          accName: accName,
          ticketId: ticketId,
        },
      });

      // 6. User ထံသို့ အောင်မြင်ကြောင်း အကြောင်းကြားစာပို့
      await ctx.reply(
        `✅ <b>Lucky Draw စာရင်းသွင်းမှု အောင်မြင်ပါသည်!</b>\n\n` +
          `🎫 သင်၏ Ticket ID: <b>${ticketId}</b>\n` +
          `👤 အကောင့်အမည်: <b>${accName}</b>\n` +
          `🎮 Game ID: ${playerId} (${serverId})\n\n` +
          `အယောက် ၁၀၀ ပြည့်ပါက Admin မှ Lucky Draw စတင်ပေးပါမည်။ ကျေးဇူးတင်ပါသည်။`,
        { parse_mode: 'HTML', ...MAIN_KEYBOARD },
      );

      // 7. လူ ၁၀၀ ပြည့်သွားရင် Admin ဆီ Notification ပို့ပေးမယ်
      const newCount = count + 1;
      if (newCount === 100) {
        const adminMsg =
          `📢 <b>Lucky Draw Participant ၁၀၀ ပြည့်သွားပါပြီ!</b>\n\n` +
          `စုစုပေါင်း: <b>${newCount} / 100</b>\n` +
          `နောက်ဆုံးစာရင်းသွင်းသူ: <b>${accName}</b>\n\n` +
          `Lucky Draw စတင်ရန် အောက်က Button ကို နှိပ်ပါ -`;

        await ctx.telegram.sendMessage(process.env.ADMIN_CHANNEL_ID, adminMsg, {
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
      console.error('Lucky Draw Error:', err);
      // Database unique constraint error (@@unique([playerId, serverId])) ကို catch လုပ်ဖို့
      if (err === 'P2002') {
        await ctx.reply('❌ ဤ Game ID သည် စာရင်းသွင်းပြီးသား ဖြစ်နေပါသည်။', {
          ...MAIN_KEYBOARD,
        });
      } else {
        await ctx.reply(
          '❌ စနစ်ချို့ယွင်းမှုတစ်ခု ဖြစ်ပေါ်ခဲ့ပါသည်။ ခေတ္တစောင့်ပြီးမှ ပြန်လည်ကြိုးစားပါ။',
          { ...MAIN_KEYBOARD },
        );
      }
      return ctx.scene.leave();
    }
  }
}
