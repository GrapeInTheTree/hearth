CREATE TABLE "SelfRolesEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"panelId" text NOT NULL,
	"userId" text NOT NULL,
	"optionId" text NOT NULL,
	"action" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SelfRolesOption" (
	"id" text PRIMARY KEY NOT NULL,
	"panelId" text NOT NULL,
	"label" text NOT NULL,
	"emoji" text NOT NULL,
	"roleId" text NOT NULL,
	"position" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SelfRolesPanel" (
	"id" text PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"channelId" text NOT NULL,
	"messageId" text NOT NULL,
	"embedTitle" text NOT NULL,
	"embedDescription" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "SelfRolesEvent" ADD CONSTRAINT "SelfRolesEvent_panelId_SelfRolesPanel_id_fk" FOREIGN KEY ("panelId") REFERENCES "public"."SelfRolesPanel"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SelfRolesEvent" ADD CONSTRAINT "SelfRolesEvent_optionId_SelfRolesOption_id_fk" FOREIGN KEY ("optionId") REFERENCES "public"."SelfRolesOption"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SelfRolesOption" ADD CONSTRAINT "SelfRolesOption_panelId_SelfRolesPanel_id_fk" FOREIGN KEY ("panelId") REFERENCES "public"."SelfRolesPanel"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "SelfRolesEvent_panelId_userId_idx" ON "SelfRolesEvent" USING btree ("panelId","userId");--> statement-breakpoint
CREATE INDEX "SelfRolesEvent_createdAt_idx" ON "SelfRolesEvent" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "SelfRolesOption_panelId_idx" ON "SelfRolesOption" USING btree ("panelId");--> statement-breakpoint
CREATE UNIQUE INDEX "SelfRolesOption_panelId_emoji_key" ON "SelfRolesOption" USING btree ("panelId","emoji");--> statement-breakpoint
CREATE UNIQUE INDEX "SelfRolesOption_panelId_position_key" ON "SelfRolesOption" USING btree ("panelId","position");--> statement-breakpoint
CREATE UNIQUE INDEX "SelfRolesOption_panelId_label_key" ON "SelfRolesOption" USING btree ("panelId","label");--> statement-breakpoint
CREATE INDEX "SelfRolesPanel_guildId_idx" ON "SelfRolesPanel" USING btree ("guildId");--> statement-breakpoint
CREATE INDEX "SelfRolesPanel_messageId_idx" ON "SelfRolesPanel" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "SelfRolesPanel_guildId_channelId_messageId_key" ON "SelfRolesPanel" USING btree ("guildId","channelId","messageId");