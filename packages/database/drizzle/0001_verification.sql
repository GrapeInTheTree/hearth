CREATE TABLE "VerificationEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"panelId" text NOT NULL,
	"userId" text NOT NULL,
	"optionId" text NOT NULL,
	"outcome" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "VerificationOption" (
	"id" text PRIMARY KEY NOT NULL,
	"panelId" text NOT NULL,
	"label" text NOT NULL,
	"emoji" text NOT NULL,
	"buttonStyle" text NOT NULL,
	"position" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "VerificationPanel" (
	"id" text PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"channelId" text NOT NULL,
	"messageId" text NOT NULL,
	"embedTitle" text NOT NULL,
	"embedDescription" text NOT NULL,
	"roleId" text NOT NULL,
	"correctOptionId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_panelId_VerificationPanel_id_fk" FOREIGN KEY ("panelId") REFERENCES "public"."VerificationPanel"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_optionId_VerificationOption_id_fk" FOREIGN KEY ("optionId") REFERENCES "public"."VerificationOption"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "VerificationOption" ADD CONSTRAINT "VerificationOption_panelId_VerificationPanel_id_fk" FOREIGN KEY ("panelId") REFERENCES "public"."VerificationPanel"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "VerificationEvent_panelId_userId_idx" ON "VerificationEvent" USING btree ("panelId","userId");--> statement-breakpoint
CREATE INDEX "VerificationEvent_createdAt_idx" ON "VerificationEvent" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "VerificationOption_panelId_idx" ON "VerificationOption" USING btree ("panelId");--> statement-breakpoint
CREATE UNIQUE INDEX "VerificationOption_panelId_position_key" ON "VerificationOption" USING btree ("panelId","position");--> statement-breakpoint
CREATE UNIQUE INDEX "VerificationOption_panelId_label_key" ON "VerificationOption" USING btree ("panelId","label");--> statement-breakpoint
CREATE INDEX "VerificationPanel_guildId_idx" ON "VerificationPanel" USING btree ("guildId");--> statement-breakpoint
CREATE UNIQUE INDEX "VerificationPanel_guildId_channelId_messageId_key" ON "VerificationPanel" USING btree ("guildId","channelId","messageId");