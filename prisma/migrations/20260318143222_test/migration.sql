/*
  Warnings:

  - A unique constraint covering the columns `[playerId,serverId]` on the table `LuckyDrawParticipant` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "LuckyDrawParticipant_playerId_serverId_key" ON "LuckyDrawParticipant"("playerId", "serverId");
