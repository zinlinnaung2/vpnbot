import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';

@Injectable()
export class LuckyDrawService {
  constructor(
    private prisma: PrismaService,
    @InjectBot() private bot: Telegraf<any>,
  ) {}

  async startDraw() {
    // ၁။ ပါဝင်သူ ၁၀၀ လုံးကို ဆွဲထုတ်မယ်
    const participants = await this.prisma.luckyDrawParticipant.findMany({
      include: { user: true },
    });

    // ၂။ Rigged (ကြိုသတ်မှတ်ထားသူ) စာရင်းကို ယူမယ်
    const predefined = await this.prisma.predefinedWinner.findMany();

    let winnersList = [];
    let remainingPool = [...participants];

    // ဆုအမျိုးအစား ၁၃ ခု သတ်မှတ်ချက်
    const prizes = [
      { name: '1st Prize 1049 Dia', key: '1049_DIA', count: 1 },
      { name: '2nd Prize Weekly Pass', key: 'WEEKLY_PASS', count: 2 },
      { name: '3rd Prize 11 Dia', key: '11_DIA', count: 10 },
    ];

    // ၃။ ဆုမဲနှိုက်ခြင်း Logic
    for (const p of prizes) {
      for (let i = 0; i < p.count; i++) {
        let winner;

        // Rigged စစ်ဆေးခြင်း (1049 နဲ့ Weekly အတွက်ပဲ လုပ်လေ့ရှိတယ်)
        if (p.key !== '11_DIA') {
          const pre = predefined.find((pw) => pw.prizeType === p.key);
          const idx = remainingPool.findIndex(
            (rp) => rp.user.telegramId === pre?.telegramId,
          );
          if (idx !== -1) {
            winner = remainingPool.splice(idx, 1)[0];
          }
        }

        // Rigged မဟုတ်ရင် Random နှိုက်မယ်
        if (!winner && remainingPool.length > 0) {
          const randomIdx = Math.floor(Math.random() * remainingPool.length);
          winner = remainingPool.splice(randomIdx, 1)[0];
        }

        if (winner) {
          winnersList.push({ ...winner, prizeName: p.name });
          // DB မှာ Winner အဖြစ် သိမ်းမယ်
          await this.prisma.luckyDrawParticipant.update({
            where: { id: winner.id },
            data: { isWinner: true, prize: p.name },
          });
        }
      }
    }

    // ၄။ Summary Message တည်ဆောက်ခြင်း (သင်အလိုရှိတဲ့ Format)
    let summaryMsg = `🎉 <b>Lucky Draw Results (အယောက် ၁၀၀ ပြည့်)</b> 🎉\n`;
    summaryMsg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    winnersList.forEach((w, index) => {
      summaryMsg += `${index + 1}. ${w.prizeName} -> <b>${w.accName}</b>\n`;
    });

    summaryMsg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    summaryMsg += `🎊 ကံထူးရှင်များအားလုံး ဂုဏ်ယူပါတယ်ခင်ဗျာ။`;

    // ၅။ အယောက် ၁၀၀ လုံးဆီ တစ်ပြိုင်နက် ပို့ခြင်း (Broadcast)
    for (const p of participants) {
      try {
        await this.bot.telegram.sendMessage(
          Number(p.user.telegramId),
          summaryMsg,
          { parse_mode: 'HTML' },
        );
      } catch (e) {
        console.error(`Error sending to ${p.user.telegramId}`);
      }
    }
  }
}
