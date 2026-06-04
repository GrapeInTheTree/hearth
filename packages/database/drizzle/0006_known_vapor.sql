CREATE TABLE "XWatcher" (
	"id" text PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"sourceHandle" text NOT NULL,
	"sourceUserId" text,
	"channelId" text NOT NULL,
	"lastTweetId" text,
	"lastCheckedAt" timestamp (3),
	"enabled" boolean DEFAULT true NOT NULL,
	"includeQuotes" boolean DEFAULT true NOT NULL,
	"includeReplies" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "XWatcherEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"watcherId" text NOT NULL,
	"tweetId" text NOT NULL,
	"tweetUrl" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"postedMessageId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "XWatcherEvent" ADD CONSTRAINT "XWatcherEvent_watcherId_XWatcher_id_fk" FOREIGN KEY ("watcherId") REFERENCES "public"."XWatcher"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "XWatcher_guildId_idx" ON "XWatcher" USING btree ("guildId");--> statement-breakpoint
CREATE UNIQUE INDEX "XWatcher_guildId_sourceHandle_channelId_key" ON "XWatcher" USING btree ("guildId","sourceHandle","channelId");--> statement-breakpoint
CREATE INDEX "XWatcherEvent_watcherId_createdAt_idx" ON "XWatcherEvent" USING btree ("watcherId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "XWatcherEvent_watcherId_tweetId_key" ON "XWatcherEvent" USING btree ("watcherId","tweetId");