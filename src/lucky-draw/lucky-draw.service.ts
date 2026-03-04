import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { MAIN_KEYBOARD } from 'src/bot/bot.update';

@Injectable()
export class LuckyDrawService {
  constructor(
    private prisma: PrismaService,
    @InjectBot() private bot: Telegraf<any>,
  ) {}

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
}
