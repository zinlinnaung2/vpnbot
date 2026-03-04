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
      // 1. Participant အားလုံးကို ဆွဲထုတ်မယ်
      const participants = await this.prisma.luckyDrawParticipant.findMany({
        include: { user: true },
      });

      if (participants.length === 0) {
        console.log('No participants found.');
        return;
      }

      // 2. Rigged List နဲ့ Winners List ကို Setup လုပ်မယ်
      const predefinedWinners = await this.prisma.predefinedWinner.findMany();
      const winnersList = [];

      // လက်ရှိ ပေါက်သွားတဲ့သူတွေကို မှတ်ထားဖို့ (တစ်ယောက်ကို တစ်ဆုပဲ ပေးမှာမို့လို့)
      const usedParticipantIds = new Set<number>();

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

          // A. RIGGED LOGIC (ဒီဆုအတွက် သတ်မှတ်ထားတဲ့သူ ရှိမရှိ အရင်ကြည့်မယ်)
          const targetRig = predefinedWinners.find(
            (rig) =>
              rig.prizeType === p.key &&
              !Array.from(usedParticipantIds).some((id) => {
                const pFound = participants.find((part) => part.id === id);
                return (
                  pFound &&
                  String(pFound.user.telegramId) === String(rig.telegramId)
                );
              }),
          );

          if (targetRig) {
            const participant = participants.find(
              (part) =>
                String(part.user.telegramId) === String(targetRig.telegramId),
            );

            if (participant && !usedParticipantIds.has(participant.id)) {
              winner = participant;
            }
          }

          // B. RANDOM LOGIC (Rigged မရှိရင် ကျန်တဲ့သူတွေထဲက Random နှိုက်မယ်)
          if (!winner) {
            // မပေါက်သေးတဲ့သူတွေထဲကမှ Rigged List ထဲမှာ (တခြားဆုအတွက်) မပါသေးတဲ့သူတွေကိုပဲ Pool ထဲထည့်မယ်
            const pool = participants.filter((pPart) => {
              if (usedParticipantIds.has(pPart.id)) return false;

              // တခြားဆုအတွက် Rigged လုပ်ထားခံရသူဖြစ်ရင် Random pool ထဲမှာ မပါစေရဘူး
              const isReservedForOtherPrize = predefinedWinners.some(
                (rig) =>
                  String(rig.telegramId) === String(pPart.user.telegramId),
              );
              return !isReservedForOtherPrize;
            });

            if (pool.length > 0) {
              const randomIdx = Math.floor(Math.random() * pool.length);
              winner = pool[randomIdx];
            }
          }

          // C. Winner ရှိရင် စာရင်းသွင်းမယ်
          if (winner) {
            usedParticipantIds.add(winner.id);
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

      // 5. Result Message ပြင်ဆင်ခြင်း
      let summaryMsg = `🎉 <b>Lucky Draw Results</b> 🎉\n`;
      summaryMsg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

      if (winnersList.length === 0) {
        summaryMsg += `⚠️ ကံစမ်းသူ မရှိပါ သို့မဟုတ် ဆုမဲပေါက်သူ မရှိပါ။`;
      } else {
        winnersList.forEach((w, index) => {
          // Telegram Name (firstName) နှင့် Game Nickname (accName) နှစ်ခုလုံးကို ပြပေးပါမည်
          const telegramName = w.user.firstName || 'User';
          summaryMsg += `${index + 1}. ${w.prizeName}\n   🏆 <b>${telegramName}</b> (Game Name: ${w.accName})\n\n`;
        });
      }

      summaryMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
      summaryMsg += `🎊 ကံထူးရှင်များအားလုံး ဂုဏ်ယူပါတယ်ခင်ဗျာ။\n\n`;

      // ဆုထုတ်ယူရန် လမ်းညွှန်ချက် ထည့်သွင်းခြင်း
      summaryMsg += `🎁 <b>ဆုလာဘ် ထုတ်ယူရန်အတွက်:</b>\n`;
      summaryMsg += `Menu ရှိ "🎁 ဆုလာဘ်ထုတ်ယူရန်" ခလုတ်ကို နှိပ်၍ Admin ထံသို့ တောင်းဆိုမှု ပေးပို့နိုင်ပါပြီခင်ဗျာ။`;

      // 6. Broadcast လုပ်ခြင်း
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
            console.error(`Broadcast failed for ${p.user.telegramId}`);
          }
        }),
      );
    } catch (error) {
      console.error('Critical Error in startDraw:', error);
    }
  }
}
