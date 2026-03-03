/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `LuckyDrawParticipant` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "LuckyDrawParticipant_userId_key" ON "LuckyDrawParticipant"("userId");
