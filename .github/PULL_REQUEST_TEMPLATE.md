## What & Why

<!-- What does this PR change? Why is it needed? Link to vault doc / Linear ticket if any. -->

## Change summary

<!-- Bullet list of meaningful changes. Keep it skimmable. -->

-

## Test plan

<!-- How was this tested? Include manual E2E if user-facing. -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated (if service-level)
- [ ] Manual E2E in dev guild (attach screenshot for UX changes)

## Quality gates

- [ ] `pnpm typecheck` — zero errors
- [ ] `pnpm lint` — zero warnings
- [ ] `pnpm test` — all green
- [ ] `pnpm build` — succeeds
- [ ] Changeset entry added (`pnpm changeset`)
- [ ] No new `process.env.X` outside `apps/bot/src/config/env.ts`
- [ ] No hardcoded brand strings (`Fannie`, `FanX`, `Kayen`, etc.) — use i18n / branding
- [ ] No secrets committed (gitleaks pre-commit ran)

## Docs sync

- [ ] `CLAUDE.md` updated (if scope/decisions changed)
- [ ] Vault docs updated (`02_projects/hearth/`)
- [ ] Project memory updated (if cross-session-relevant)

## Open questions / follow-ups

<!-- Anything for reviewer or future PRs. -->
