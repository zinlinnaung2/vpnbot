-- CreateTable
CREATE TABLE "LuckyDrawParticipant" (
    "id" SERIAL NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "accName" TEXT NOT NULL,
    "prize" TEXT,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "isClaimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuckyDrawParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredefinedWinner" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "prizeType" TEXT NOT NULL,

    CONSTRAINT "PredefinedWinner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LuckyDrawParticipant_ticketId_key" ON "LuckyDrawParticipant"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "PredefinedWinner_telegramId_key" ON "PredefinedWinner"("telegramId");

-- AddForeignKey
ALTER TABLE "LuckyDrawParticipant" ADD CONSTRAINT "LuckyDrawParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
