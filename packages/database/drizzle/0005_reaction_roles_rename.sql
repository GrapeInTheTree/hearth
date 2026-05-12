-- Pure-rename migration: SelfRoles{Panel,Option,Event} →
-- ReactionRoles{Panel,Option,Event}. Renames the tables, all their
-- indexes, and the FK constraints. No data is touched — every row
-- survives intact under the new table name.
--
-- The TypeScript schema is updated to match. `dbDrizzle` reads the
-- new identifiers (`schema.reactionRolesPanel` etc.); existing rows
-- are visible to caller code immediately after migration completes.
--
-- Why a hand-written migration rather than drizzle-kit's auto-gen:
-- drizzle-kit treats renamed tables as DROP + CREATE unless an
-- interactive prompt confirms the rename, and we can't risk a
-- destructive plan if migrate runs unattended. The matching
-- 0005_snapshot.json is a copy of 0004's snapshot with every
-- "SelfRoles" / "self_roles" replaced by "ReactionRoles" /
-- "reaction_roles" — same shape, new names.

ALTER TABLE "SelfRolesPanel" RENAME TO "ReactionRolesPanel";--> statement-breakpoint
ALTER TABLE "SelfRolesOption" RENAME TO "ReactionRolesOption";--> statement-breakpoint
ALTER TABLE "SelfRolesEvent" RENAME TO "ReactionRolesEvent";--> statement-breakpoint

ALTER INDEX "SelfRolesPanel_guildId_idx" RENAME TO "ReactionRolesPanel_guildId_idx";--> statement-breakpoint
ALTER INDEX "SelfRolesPanel_messageId_idx" RENAME TO "ReactionRolesPanel_messageId_idx";--> statement-breakpoint
ALTER INDEX "SelfRolesPanel_guildId_channelId_messageId_key" RENAME TO "ReactionRolesPanel_guildId_channelId_messageId_key";--> statement-breakpoint

ALTER INDEX "SelfRolesOption_panelId_idx" RENAME TO "ReactionRolesOption_panelId_idx";--> statement-breakpoint
ALTER INDEX "SelfRolesOption_panelId_emoji_key" RENAME TO "ReactionRolesOption_panelId_emoji_key";--> statement-breakpoint
ALTER INDEX "SelfRolesOption_panelId_position_key" RENAME TO "ReactionRolesOption_panelId_position_key";--> statement-breakpoint
ALTER INDEX "SelfRolesOption_panelId_label_key" RENAME TO "ReactionRolesOption_panelId_label_key";--> statement-breakpoint

ALTER INDEX "SelfRolesEvent_panelId_userId_idx" RENAME TO "ReactionRolesEvent_panelId_userId_idx";--> statement-breakpoint
ALTER INDEX "SelfRolesEvent_createdAt_idx" RENAME TO "ReactionRolesEvent_createdAt_idx";--> statement-breakpoint
ALTER INDEX "SelfRolesEvent_optionId_idx" RENAME TO "ReactionRolesEvent_optionId_idx";--> statement-breakpoint

ALTER TABLE "ReactionRolesOption" RENAME CONSTRAINT "SelfRolesOption_panelId_SelfRolesPanel_id_fk" TO "ReactionRolesOption_panelId_ReactionRolesPanel_id_fk";--> statement-breakpoint
ALTER TABLE "ReactionRolesEvent" RENAME CONSTRAINT "SelfRolesEvent_panelId_SelfRolesPanel_id_fk" TO "ReactionRolesEvent_panelId_ReactionRolesPanel_id_fk";--> statement-breakpoint
ALTER TABLE "ReactionRolesEvent" RENAME CONSTRAINT "SelfRolesEvent_optionId_SelfRolesOption_id_fk" TO "ReactionRolesEvent_optionId_ReactionRolesOption_id_fk";
