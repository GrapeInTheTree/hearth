-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'claimed', 'closed');

-- CreateTable
CREATE TABLE "GuildConfig" (
    "guildId" TEXT NOT NULL,
    "archiveCategoryId" TEXT,
    "alertChannelId" TEXT,
    "ticketCounter" INTEGER NOT NULL DEFAULT 0,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "Panel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "embedTitle" TEXT NOT NULL,
    "embedDescription" TEXT NOT NULL,
    "embedColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelTicketType" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "buttonStyle" TEXT NOT NULL,
    "buttonLabel" TEXT,
    "buttonOrder" INTEGER NOT NULL DEFAULT 0,
    "activeCategoryId" TEXT NOT NULL,
    "supportRoleIds" TEXT[],
    "pingRoleIds" TEXT[],
    "perUserLimit" INTEGER,
    "welcomeMessage" TEXT,

    CONSTRAINT "PanelTicketType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "panelTypeId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "welcomeMessageId" TEXT,
    "number" INTEGER NOT NULL,
    "openerId" TEXT NOT NULL,
    "claimedById" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Panel_guildId_idx" ON "Panel"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Panel_guildId_channelId_messageId_key" ON "Panel"("guildId", "channelId", "messageId");

-- CreateIndex
CREATE INDEX "PanelTicketType_panelId_idx" ON "PanelTicketType"("panelId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_channelId_key" ON "Ticket"("channelId");

-- CreateIndex
CREATE INDEX "Ticket_guildId_status_idx" ON "Ticket"("guildId", "status");

-- CreateIndex
CREATE INDEX "Ticket_openerId_status_idx" ON "Ticket"("openerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_guildId_number_key" ON "Ticket"("guildId", "number");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "PanelTicketType" ADD CONSTRAINT "PanelTicketType_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_panelTypeId_fkey" FOREIGN KEY ("panelTypeId") REFERENCES "PanelTicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Race-condition guard for ticket creation: at most one (guildId, openerId, panelTypeId)
-- can hold status in ('open', 'claimed') at any time. Belt-and-suspenders with
-- pg_advisory_xact_lock taken in TicketService.openTicket. Postgres partial unique
-- indexes are not yet expressible in Prisma schema, so we maintain it via raw SQL.
CREATE UNIQUE INDEX "ticket_open_dedupe"
    ON "Ticket" ("guildId", "openerId", "panelTypeId")
    WHERE status IN ('open', 'claimed');
