CREATE TYPE "public"."TicketStatus" AS ENUM('open', 'claimed', 'closed');--> statement-breakpoint
CREATE TABLE "GuildConfig" (
	"guildId" text PRIMARY KEY NOT NULL,
	"archiveCategoryId" text,
	"alertChannelId" text,
	"ticketCounter" integer DEFAULT 0 NOT NULL,
	"defaultLocale" text DEFAULT 'en' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Panel" (
	"id" text PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"channelId" text NOT NULL,
	"messageId" text NOT NULL,
	"embedTitle" text NOT NULL,
	"embedDescription" text NOT NULL,
	"embedColor" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PanelTicketType" (
	"id" text PRIMARY KEY NOT NULL,
	"panelId" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"buttonStyle" text NOT NULL,
	"buttonLabel" text,
	"buttonOrder" integer DEFAULT 0 NOT NULL,
	"activeCategoryId" text NOT NULL,
	"supportRoleIds" text[] NOT NULL,
	"pingRoleIds" text[] NOT NULL,
	"perUserLimit" integer,
	"welcomeMessage" text
);
--> statement-breakpoint
CREATE TABLE "Ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"panelId" text NOT NULL,
	"panelTypeId" text NOT NULL,
	"channelId" text NOT NULL,
	"welcomeMessageId" text,
	"number" integer NOT NULL,
	"openerId" text NOT NULL,
	"claimedById" text,
	"status" "TicketStatus" DEFAULT 'open' NOT NULL,
	"openedAt" timestamp (3) DEFAULT now() NOT NULL,
	"claimedAt" timestamp (3),
	"closedAt" timestamp (3),
	"closedById" text,
	"closeReason" text
);
--> statement-breakpoint
CREATE TABLE "TicketEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"ticketId" text NOT NULL,
	"type" text NOT NULL,
	"actorId" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PanelTicketType" ADD CONSTRAINT "PanelTicketType_panelId_Panel_id_fk" FOREIGN KEY ("panelId") REFERENCES "public"."Panel"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_panelId_Panel_id_fk" FOREIGN KEY ("panelId") REFERENCES "public"."Panel"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_panelTypeId_PanelTicketType_id_fk" FOREIGN KEY ("panelTypeId") REFERENCES "public"."PanelTicketType"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_Ticket_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Panel_guildId_idx" ON "Panel" USING btree ("guildId");--> statement-breakpoint
CREATE UNIQUE INDEX "Panel_guildId_channelId_messageId_key" ON "Panel" USING btree ("guildId","channelId","messageId");--> statement-breakpoint
CREATE INDEX "PanelTicketType_panelId_idx" ON "PanelTicketType" USING btree ("panelId");--> statement-breakpoint
CREATE UNIQUE INDEX "Ticket_channelId_key" ON "Ticket" USING btree ("channelId");--> statement-breakpoint
CREATE INDEX "Ticket_guildId_status_idx" ON "Ticket" USING btree ("guildId","status");--> statement-breakpoint
CREATE INDEX "Ticket_openerId_status_idx" ON "Ticket" USING btree ("openerId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "Ticket_guildId_number_key" ON "Ticket" USING btree ("guildId","number");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_open_dedupe" ON "Ticket" USING btree ("guildId","openerId","panelTypeId") WHERE status IN ('open', 'claimed');--> statement-breakpoint
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent" USING btree ("ticketId","createdAt");