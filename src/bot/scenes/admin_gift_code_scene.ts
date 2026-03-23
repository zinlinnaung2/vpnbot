import { Ctx, On, Scene, SceneEnter } from 'nestjs-telegraf';
import { BotContext } from 'src/interfaces/bot-context.interface';
import { PrismaService } from 'src/prisma/prisma.service';
import { Markup } from 'telegraf';

@Scene('admin_gift_code_scene')
export class AdminGiftCodeScene {
  constructor(private readonly prisma: PrismaService) {}

  @SceneEnter()
  async onEnter(@Ctx() ctx: BotContext) {
    // We remove the Markup.keyboard here to avoid the 400 error.
    // In a Channel/Admin environment, it's safer to use text-based cancel commands
    // or simply wait for the code.
    await ctx.reply(
      '🔑 <b>GiftCard Code ကို ရိုက်ထည့်ပေးပါ -</b>\n\n(ပယ်ဖျက်လိုပါက "cancel" ဟု ရိုက်ပါ)',
      {
        parse_mode: 'HTML',
      },
    );
  }

  @On('text')
  @On('channel_post')
  async onCodeReceived(@Ctx() ctx: BotContext) {
    const text = (ctx.message as any).text;
    const state = ctx.scene.state as { purchaseId: number };

    // Standardize the cancel check
    if (text.toLowerCase() === 'cancel' || text === '❌ မပို့တော့ပါ (Cancel)') {
      await ctx.reply('Cancelled.');
      return ctx.scene.leave();
    }

    try {
      // 1. Update Purchase in DB
      const purchase = await this.prisma.purchase.update({
        where: { id: state.purchaseId },
        data: { status: 'COMPLETED' },
        include: { user: true, product: true },
      });

      // 2. Notify the User with the Code
      const userMsg =
        `✅ <b>Gift Card ဝယ်ယူမှု အောင်မြင်ပါသည်!</b>\n\n` +
        `📦 ပစ္စည်း: <b>${purchase.product.name}</b>\n` +
        `🔢 အရေအတွက်: <b>${purchase.quantity}</b>\n` +
        `💰 ကျသင့်ငွေ: <b>${purchase.amount.toLocaleString()} MMK</b>\n\n` +
        `🎁 လူကြီးမင်း၏ Code: <code>${text}</code>\n\n` +
        `အသုံးပြုပေးမှုအတွက် ကျေးဇူးတင်ပါသည်! 🙏`;

      await ctx.telegram.sendMessage(
        Number(purchase.user.telegramId),
        userMsg,
        { parse_mode: 'HTML' },
      );

      // 3. Confirm to Admin
      await ctx.reply(
        `✅ Code ပို့ပြီးပါပြီ။ Order #${state.purchaseId} Completed.`,
      );

      return ctx.scene.leave();
    } catch (e) {
      console.error(e);
      await ctx.reply('❌ အမှားအယွင်း ဖြစ်သွားပါသည်။');
      return ctx.scene.leave();
    }
  }
}
