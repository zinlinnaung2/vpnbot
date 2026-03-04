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
      // 1. Fetch all participants and the rigging instructions
      const participants = await this.prisma.luckyDrawParticipant.findMany({
        include: { user: true },
      });

      // We clone the list so we can safely remove winners as they are picked
      let remainingPool = [...participants];

      const predefinedWinners = await this.prisma.predefinedWinner.findMany();
      // Clone predefined winners to manage multiple riggings for the same prize type
      let rigPool = [...predefinedWinners];

      const winnersList = [];

      // 2. Define the prize structure
      const prizes = [
        { name: '1st Prize 1049 Dia', key: '1049_DIA', count: 1 },
        { name: '2nd Prize Weekly Pass', key: 'WEEKLY_PASS', count: 2 },
        { name: '3rd Prize 11 Dia', key: '11_DIA', count: 10 },
      ];

      // 3. Main Drawing Logic
      for (const p of prizes) {
        for (let i = 0; i < p.count; i++) {
          let winner = null;

          // A. RIGGED LOGIC
          // Check if there is a predefined winner for this specific prize category
          const rigIndex = rigPool.findIndex((rp) => rp.prizeType === p.key);

          if (rigIndex !== -1) {
            const targetRig = rigPool[rigIndex];

            // Find this person in the current participant pool
            const participantIndex = remainingPool.findIndex(
              (part) =>
                BigInt(part.user.telegramId) === BigInt(targetRig.telegramId),
            );

            if (participantIndex !== -1) {
              // Successfully found the rigged user in the pool
              winner = remainingPool.splice(participantIndex, 1)[0];
              // Remove this instruction so it's not used again
              rigPool.splice(rigIndex, 1);
            }
          }

          // B. RANDOM LOGIC
          // If no rigged winner was found for this slot, pick someone randomly
          if (!winner && remainingPool.length > 0) {
            const randomIdx = Math.floor(Math.random() * remainingPool.length);
            winner = remainingPool.splice(randomIdx, 1)[0];
          }

          // C. SAVE TO DATABASE
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

      // 4. Construct Results Message
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

      // 5. Broadcast to all participants
      // Using Promise.allSettled to ensure one failure doesn't stop the whole broadcast
      // ... inside startDraw() after the summaryMsg is built

      // 5. Broadcast to all participants
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
