import { Ctx, On, Scene, SceneEnter } from 'nestjs-telegraf';
import { BotContext } from 'src/interfaces/bot-context.interface';
import { PrismaService } from 'src/prisma/prisma.service';
import { Markup } from 'telegraf';

@Scene('admin_gift_code_scene')
export class AdminGiftCodeScene {
  constructor(private readonly prisma: PrismaService) {}

  @SceneEnter()
  async onEnter(@Ctx() ctx: BotContext) {
    await ctx.reply(
      '🔑 <b>GiftCard Code ကို ရိုက်ထည့်ပေးပါ -</b>\n\n(Admin account မဟုတ်ဘဲ Channel အနေဖြင့် ရိုက်ထည့်နိုင်သည်)',
      { parse_mode: 'HTML' },
    );
  }

  @On('channel_post') // This catches posts made by the Channel identity
  async onCodeReceived(@Ctx() ctx: any) {
    // ✨ FIX: Check both message (Private/Group) and channelPost (Channel)
    const text = ctx.message?.text || ctx.channelPost?.text;
    const state = ctx.scene.state as { purchaseId: number };

    // If there's no text (e.g. someone sent a sticker), do nothing
    if (!text) return;

    // Standardize the cancel check
    if (text.toLowerCase() === 'cancel' || text === '❌ မပို့တော့ပါ (Cancel)') {
      await ctx.reply('✅ Cancelled.');
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
      // Use ctx.chat.id to reply back to the same channel
      await ctx.telegram.sendMessage(
        ctx.chat.id,
        `✅ Code [ <code>${text}</code> ] ကို User ထံ ပို့ပြီးပါပြီ။\nOrder #${state.purchaseId} Completed.`,
        { parse_mode: 'HTML' },
      );

      return ctx.scene.leave();
    } catch (e) {
      console.error('Final Save Error:', e);
      await ctx.reply('❌ အမှားအယွင်း ဖြစ်သွားပါသည်။');
      return ctx.scene.leave();
    }
  }
}
