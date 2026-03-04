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
      // 6. Broadcast လုပ်ခြင်း (Personalized Messages)
      await Promise.allSettled(
        participants.map(async (p) => {
          try {
            // Check if this participant ID is in the winners set
            const isMainWinner = usedParticipantIds.has(p.id);

            // Start with the base summary message (All Winners List)
            let finalMessage = summaryMsg;

            if (!isMainWinner) {
              // --- မဲမပေါက်သူများအတွက် (နှစ်သိမ့်ဆု 5% Coupon ထည့်ပေးခြင်း) ---

              // 1. Database မှာ 5% Coupon ကို သိမ်းဆည်းမယ် (GamePurchaseScene က ဒါကို ရှာမှာဖြစ်လို့ စာသားမှန်ဖို့ လိုပါတယ်)
              await this.prisma.luckyDrawParticipant.update({
                where: { id: p.id },
                data: {
                  prize: '5% Discount Coupon', // စာသားအတိအကျ ဖြစ်ရပါမယ်
                  isWinner: false,
                  isClaimed: false, // မသုံးရသေးကြောင်း အမှတ်အသားပြုခြင်း
                },
              });

              // 2. User ဆီ ပို့မယ့် Message ကို ဆက်ရေးမယ်
              finalMessage += `\n\n🎁 <b>နှစ်သိမ့်ဆု (Consolation Prize)</b> 🎁\n`;
              finalMessage += `----------------------------------\n`;
              finalMessage += `Lucky Draw တွင် မဲမပေါက်ခဲ့သော်လည်း ပါဝင်ပေးတဲ့အတွက် ကျေးဇူးတင်သောအားဖြင့် လူကြီးမင်းအတွက် <b>5% Discount Coupon</b> ကို လက်ဆောင်ပေးလိုက်ပါတယ်ခင်ဗျာ။\n\n`;
              finalMessage += `🎟 Coupon ID: <b>5OFF-${p.ticketId}</b>\n\n`;
              finalMessage += `💡 <b>အသုံးပြုပုံ:</b>\n`;
              finalMessage += `နောက်တစ်ကြိမ် ဂိမ်းပစ္စည်းများ ဝယ်ယူသည့်အခါ System မှ ဤ Coupon ကို <b>အလိုအလျောက်</b> စစ်ဆေးပေးမှာဖြစ်ပြီး 5% Discount နှုတ်ပေးသွားမှာ ဖြစ်ပါတယ်ခင်ဗျာ။`;
            } else {
              // --- မဲပေါက်သူများအတွက် ---
              // ရှေ့က Main Loop မှာ Prize ကို Update လုပ်ပြီးသား ဖြစ်ရပါမယ်။
              finalMessage += `\n\n🎊 <b>ဂုဏ်ယူပါတယ် လူကြီးမင်းရှင့်!</b>\n`;
              finalMessage += `လူကြီးမင်းသည် ကံထူးရှင်စာရင်းတွင် ပါဝင်သောကြောင့် ဆုလာဘ်ထုတ်ယူရန် Menu ရှိ "🎁 ဆုလာဘ်ထုတ်ယူရန်" ခလုတ်ကို နှိပ်၍ Admin ထံ Request ပို့ပေးပါခင်ဗျာ။`;
            }

            // Send the personalized message to the user
            await this.bot.telegram.sendMessage(
              Number(p.user.telegramId),
              finalMessage,
              {
                parse_mode: 'HTML',
                ...MAIN_KEYBOARD,
              },
            );
          } catch (e: any) {
            console.error(
              `Broadcast failed for ${p.user.telegramId}:`,
              e.message,
            );
          }
        }),
      );
    } catch (error) {
      console.error('Critical Error in startDraw:', error);
    }
  }
}
