# CLAUDE.md — Hearth (Discord Community Ops Platform)

> 이 파일은 Claude Code가 매 세션 자동 로드한다. 프로젝트의 **북극성**(목표·결정·금지사항)을 여기에 둔다.
> 코드 위치/관습 같은 변동성 큰 정보는 별도 docs로 분리하고, 여기엔 **잘 안 변하는 것**만 둔다.
> 모든 사실은 2026-04-28 시점 검증.

**프로젝트 이름:** **Hearth**. 봇 white-label이라 운영자가 `BOT_NAME` env로 자기 봇 이름을 정함 (`Fannie`, `Acme` 등). Hearth는 코드베이스/오픈소스 정체성. 패키지 스코프 `@hearth/*`, Docker 이미지 `hearth-bot:local` / `hearth-dashboard:local`, repo `GrapeInTheTree/hearth`.

---

## 1. 프로젝트 정체성

**제품:** **White-label** 범용 Discord 봇 (MEE6 / Ticket Tool 클래스). 한 코드베이스를 여러 커뮤니티에 배포 — 각 커뮤니티가 자기 Discord app을 등록하고 env로 브랜딩만 바꿔 사용한다.

**1차 배포 대상:** **FanX Protocol** (Kayen 이전 DEX 채널, Chiliz 생태계). 봇 이름 디폴트 `BOT_NAME=Fannie` (env로 언제든 교체 가능). 차후 Kayen, 기타 Chiliz 생태계 커뮤니티로 확장.

**목표 품질 수준:**

- **기능**: MEE6급 — 티켓, 모더레이션, 레벨링, 자동역할, 환영, 로깅, 자동모드, 알림 등 풀 카탈로그
- **코드**: Uniswap급 — 모노레포 + 강타입 + 100% 테스트 가능한 service 분리 + Conventional Commits + Changesets
- **운영**: 24/7 production. 배포 단위 = 커뮤니티 1개. 배포 안에서는 multi-guild (목표 1k+ 길드 → 추후 sharding)

**White-label 원칙 (불변):**

- 봇 이름, 아이콘, 색상, 푸터, 카피 톤 등 **모든 브랜딩은 env / DB config**
- 코드/템플릿 어디에도 "Kayen", "FanX", "Fannie" 같은 고유명사 **하드코딩 절대 금지**
- 메시지 카피는 i18n-ready 템플릿 (변수 치환) — 영어 디폴트 + 한국어 등 추가 가능
- 새 커뮤니티 온보딩 = `.env` 작성 + `docker compose up -d`. 코드 수정 0줄이 정상.

**비목표 (NOT this project):**

- 음악 봇 — Discord ToS 리스크 (YouTube C&D Groovy/Rythm 2021). v1 범위 제외.
- 호스팅 SaaS / 멀티테넌트 단일 인스턴스 — 각 커뮤니티가 자기 인스턴스 띄움 (운영 격리)
- AI 기능 (LLM 응답) — v2 이후 검토

---

## 2. 1차 결정 (변경 시 ADR 필수)

### 스택

| 레이어         | 선택                                                                           | 대안 검토 결과                                                                                        |
| -------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 언어           | **TypeScript 5.8+ strict**                                                     | —                                                                                                     |
| 런타임         | **Node.js 22.22.x LTS** (정확히 핀)                                            | 24는 ecosystem 미흡                                                                                   |
| 패키지 매니저  | **pnpm 9+**                                                                    | Bun 1.3은 봇 ecosystem 미검증                                                                         |
| Discord SDK    | **discord.js v14.26+**                                                         | Necord (NestJS 강제), Sapphire (위에 얹음)                                                            |
| Bot 프레임워크 | **Sapphire Framework v5.5+**                                                   | raw discord.js는 boilerplate 폭증                                                                     |
| ORM            | **Prisma 7** (현재 7.8.0, prisma-client ESM generator)                         | Drizzle은 SQL-native지만 다중 테이블 DX 손해 / 레거시 prisma-client-js는 CJS만 출력해서 Node ESM 불가 |
| DB             | **PostgreSQL 16+**                                                             | per-guild config는 JSONB                                                                              |
| Cache/Queue    | **(옵셔널)** Redis 7 + BullMQ — Phase 4부터 도입                               | v1~3까지는 Postgres + 인메모리로 충분 (아래 §6.1 참조)                                                |
| 빌드           | **tsup** (build) + **tsx** (dev watch)                                         | esbuild 직접 호출은 너무 raw                                                                          |
| 모노레포       | **Turborepo + pnpm workspaces**                                                | Nx는 학습곡선 ↑                                                                                       |
| 린터           | **ESLint v9 flat config** (oxlint 점진 이행)                                   | oxlint 지금 전면 도입은 룰 누락 위험                                                                  |
| 포맷터         | **Prettier 3**                                                                 | oxfmt 정착되면 검토                                                                                   |
| 테스트         | **Vitest 4**                                                                   | Jest는 ESM/속도 부담                                                                                  |
| Git hooks      | **lefthook**                                                                   | husky 대체 (yaml + 빠름)                                                                              |
| Commits        | **Conventional Commits + commitlint**                                          | —                                                                                                     |
| 릴리스         | **Changesets**                                                                 | semantic-release는 단일 패키지 전용                                                                   |
| 배포           | **GCP Compute Engine VM + docker-compose** (멀티스테이지 build)                | Cloud Run 부적합 (gateway WebSocket 영구 연결 필요)                                                   |
| 관측           | **pino + Sentry + HTTP healthcheck**                                           | —                                                                                                     |
| 웹 대시보드    | **Next.js 15 + Tailwind v4 + shadcn/ui + Auth.js v5**                          | Vercel + Neon은 self-host 정신 위배 — 같은 VM에 nginx 뒤로 배포 (Path C)                              |
| Dashboard 폼   | **react-hook-form 7 + @hookform/resolvers/zod**                                | useState chain은 검증 분산 + Server Action round-trip → 사용자 피드백 지연                            |
| 도메인 패키지  | **`@hearth/tickets-core`** (티켓 도메인 services + ports + i18n + zod schemas) | 봇/대시보드 양쪽이 import. discord-api-types만 사용 (런타임 의존 0)                                   |

### 도메인 결정

- **Components V2** vs 레거시 embeds — **레거시 embeds로 시작**. Components V2는 message flag `IS_COMPONENTS_V2 = 1 << 15 (32768)` 켜면 `content`/`embeds`/`poll`/`stickers` 전부 비활성. UX 추상화가 완전히 달라져서 v1 안정화 후 마이그레이션 검토.
- **Sharding** — `ShardingManager`로 처음부터 띄우되 shard 1개로 시작. 2,500 길드 직전부터 Discord 강제.
- **AutoMod** — Discord 네이티브 `AutoModerationRule` API + 봇 자체 룰 **공존**. 네이티브는 `AUTO_MODERATION_ACTION_EXECUTION` 이벤트로 후킹.
- **Permission model** — 2026-02-23 split 적용: `PIN_MESSAGES`, `BYPASS_SLOWMODE`, `CREATE_GUILD_EXPRESSIONS`가 별 권한. invite scope 계산 시 **반드시 신규 비트 포함**.
- **Branding 주입 경로** — `apps/bot/src/config/branding.ts`가 env에서 읽어 typed `Branding` 객체 export. 이 객체만 봇 전체가 참조. env 키: `BOT_NAME`, `BOT_BRAND_COLOR` (hex), `BOT_ICON_URL`, `BOT_FOOTER_TEXT`, `BOT_SUPPORT_URL`, `BOT_LOCALE` (`en`/`ko` 등).
- **Prisma 7 driver adapter 패턴** — Prisma 7부터 `datasource.url`이 `schema.prisma`에서 빠지고 `packages/database/prisma.config.ts`로 이동. runtime PrismaClient는 `@prisma/adapter-pg` (node-postgres 기반)를 통해 connection. `prisma generate`는 connect 안 하므로 dev 편의 placeholder URL을 npm script에 inline (`db:generate`, `build`). 진짜 migrate는 `DATABASE_URL` export 후 `db:migrate*` 실행.
- **Prisma 7 prisma-client (ESM) generator** — schema.prisma의 `generator client { provider = "prisma-client" ... }` (no `-js` 접미사). 출력 위치 `packages/database/src/generated/client/` (gitignored). `runtime=nodejs`, `moduleFormat=esm`, `generatedFileExtension=ts`, `importFileExtension=js`. 레거시 `prisma-client-js`는 CJS spread (`module.exports = {...require('.prisma/client/default')}`)라 Node ESM의 cjs-module-lexer가 named export를 정적 분석 못 해서 `import { PrismaClient } from '@prisma/client'`가 런타임에 실패함 — 이게 새 generator를 쓰는 이유.
- **Sapphire piece 디렉토리 규칙 (불변, 위반 시 silent fail)** — Sapphire의 `InteractionHandlerStore`는 `interaction-handlers/` (하이픈) 폴더만 스캔. `interactions/` 같은 변형은 무시됨. **`Listener` / `Command` / `InteractionHandler` / `Precondition` 모두 1 파일 = 1 클래스 export** (default export 아니어도 OK이지만 한 파일에 두 개 두면 두 번째는 등록 안 됨). `Precondition`의 `name` 옵션은 명시 설정 필수 — 안 하면 Sapphire가 filename basename으로 fallback해서 `preconditions: ['AdminOnly']` 같은 참조가 깨짐.
- **ChatInputCommandDenied 이벤트 처리 필수** — Sapphire는 precondition이 `this.error(...)` 반환 시 `ChatInputCommandDenied` 이벤트를 emit하지만 자동 응답 안 함. listener 없으면 Discord가 3초 후 "application did not respond" 표시. `listeners/chatInputCommandDenied.ts`가 i18n 메시지 ephemeral relay.
- **메시지 템플릿** — 모든 사용자-대면 카피는 `apps/bot/src/i18n/<locale>/<domain>.ts`에 키-값 형태. 변수 치환은 ICU MessageFormat 또는 단순 `{var}` 치환. 카피 변경 = 코드 수정 없이 i18n 파일만.

---

## 3. 디렉토리 구조 (강제)

```
hearth/
├── apps/
│   ├── bot/                       # 봇 런타임 — 유일한 배포 단위
│   │   ├── src/
│   │   │   ├── commands/          # 슬래시 커맨드, 도메인별 폴더
│   │   │   │   ├── moderation/    # ban, kick, warn, timeout
│   │   │   │   ├── tickets/       # panel, close, claim
│   │   │   │   ├── leveling/      # rank, leaderboard
│   │   │   │   ├── roles/         # selfrole, autorole 설정
│   │   │   │   └── utility/       # ping, help, serverinfo
│   │   │   ├── listeners/         # discord.js Client 이벤트 — 1 file = 1 Listener class (Sapphire 1 piece per file)
│   │   │   ├── interaction-handlers/  # buttons/, modals/ — Sapphire 하드코딩 폴더명 (interactions/ 아님)
│   │   │   ├── services/          # 비즈니스 로직 (TicketService, XpService) — discord.js 객체 의존 0
│   │   │   ├── services/ports/    # DiscordGateway interface + Djs 구현 (services 의 외부 I/O seam)
│   │   │   ├── jobs/              # BullMQ workers (reminder, autoUnmute, autoClose)
│   │   │   ├── preconditions/     # 권한 가드. name 옵션 명시 필수 (filename fallback 위험)
│   │   │   ├── lib/               # 봇-only 유틸 (interactionHelpers, replyEphemeral, logger 등). 도메인 유틸은 @hearth/tickets-core에
│   │   │   ├── config/            # zod env 스키마, branding (frozen)
│   │   │   ├── i18n/              # 봇-only common 카피 + tickets-core 재export
│   │   │   ├── internal-api/      # /healthz + /internal/* HTTP server (대시보드 호출처)
│   │   │   ├── container.ts       # Sapphire DI container + attachServices(gateway)
│   │   │   └── index.ts           # bootstrap
│   │   ├── tests/                 # 통합 테스트 (testcontainers pg 16)
│   │   ├── Dockerfile
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── dashboard/                 # Next.js 15 웹 대시보드 — bot.fanx.xyz 류 서브도메인에 nginx 뒤로 배포
│       ├── src/
│       │   ├── app/               # App Router. (authenticated)/g/[guildId]/* 그룹이 RSC 가드
│       │   │   ├── api/auth/[...nextauth]/  # Auth.js v5 핸들러
│       │   │   ├── login/         # Discord OAuth 진입
│       │   │   ├── (authenticated)/select-guild/
│       │   │   └── (authenticated)/g/[guildId]/{,panels,tickets,settings}/
│       │   ├── actions/           # 'use server' Server Actions (panels, ticket-types, guild-config, auth, login)
│       │   ├── components/
│       │   │   ├── ui/            # shadcn primitives (button, card, input, dropdown-menu, ...)
│       │   │   ├── layout/        # brand, sidebar, topbar, user-menu
│       │   │   ├── panels/        # panel-form, panel-preview, ticket-type-form, remove-type-button
│       │   │   ├── pickers/       # channel/category/role-multi 선택기
│       │   │   └── settings/      # settings-form
│       │   ├── lib/               # auth, env, botClient (timeout+circuit-breaker), discordOauth, server-auth
│       │   ├── config/branding.ts # 봇과 동일 env 키 — 프론트 BOT_NAME/COLOR 미러
│       │   ├── i18n/              # 대시보드 chrome 카피 (티켓 도메인 카피는 tickets-core)
│       │   ├── types/             # 봇 internal API 응답 타입 미러
│       │   └── middleware.ts      # Edge 호환 (쿠키만 체크) — auth chain은 RSC 레이어에서
│       ├── tests/unit/            # auth-permissions, botClient, actions/* (Vitest)
│       ├── Dockerfile             # multi-stage, Next.js standalone 출력
│       ├── next.config.ts         # transpilePackages + serverExternalPackages
│       └── package.json
├── packages/
│   ├── database/                  # Prisma schema + 마이그레이션 + 클라이언트 export
│   │   ├── prisma/                # schema.prisma + migrations/ + prisma.config.ts
│   │   └── src/
│   │       ├── client.ts          # Proxy 기반 lazy PrismaClient (Next.js build 시 import OK)
│   │       ├── index.ts           # 공개 surface (db, Prisma, model types, TicketStatus)
│   │       └── generated/client/  # prisma-client (ESM) generator 출력 — gitignored
│   ├── tickets-core/              # 봇 + 대시보드 공용 — 티켓 도메인 로직 (services + ports + lib + i18n + zod schemas)
│   │   ├── src/
│   │   │   ├── panelService.ts    # PanelService (DB + gateway)
│   │   │   ├── ticketService.ts   # TicketService (advisory lock + lifecycle)
│   │   │   ├── guildConfigService.ts
│   │   │   ├── ports/discordGateway.ts  # interface — djs 구현은 봇에 잔류
│   │   │   ├── lib/               # customId, advisoryLock, lockKeys, format, panelBuilder (discord-api-types)
│   │   │   ├── schemas.ts         # PanelInputSchema, TicketTypeInputSchema, GuildConfigInputSchema
│   │   │   ├── i18n/              # 티켓 도메인 카피 (en bundle)
│   │   │   └── branding.ts        # Branding interface
│   │   └── tests/unit/            # services + lib 단위 테스트 + helpers (FakeDb, FakeGateway)
│   ├── shared/                    # 양 앱 공용 타입/zod/상수 (Result, AppError 계층)
│   ├── tsconfig/                  # base.json, bot.json, web.json
│   └── eslint-config/             # 공유 ESLint flat config
├── docs/
│   ├── architecture/              # ADR (Architecture Decision Records)
│   ├── features/                  # 기능별 스펙 (tickets.md, moderation.md ...)
│   └── runbook/                   # 운영 런북
├── .changeset/
├── .github/workflows/             # ci.yml, release.yml, docker.yml
├── lefthook.yml
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.json                  # project references
├── commitlint.config.js
└── package.json                   # private:true, devDeps만
```

**불변 규칙:**

- 티켓 도메인 로직은 `packages/tickets-core/`에만. 봇 / 대시보드 모두 여기서 import — 단일 진실의 원천.
- `packages/tickets-core/`는 **discord.js 런타임 의존 0**. `discord-api-types` (types-only)만 사용. 대시보드가 import해도 bundle 부담 없음.
- **Client component (`'use client'`)는 `@hearth/tickets-core` 배럴 대신 `@hearth/tickets-core/schemas` subpath만 import.** 배럴은 services를 통해 `@hearth/database` → `pg` → `node:dns/net/tls`까지 끌고 와서 webpack이 client bundle에 못 넣음. schema 모듈만 별도 entry로 노출됨. 서버측 (Server Actions / RSC) 코드는 배럴 그대로 OK.
- 대시보드 Server Action은 `tickets-core` 서비스 호출 + DB write만. **Discord 측 render는 항상 `botClient`로 봇의 `/internal/*` HTTP API 경유** — 대시보드는 Discord 토큰 보유 0.
- `apps/dashboard/src/`에서 `discord.js` import 금지. 채널/카테고리/role 목록 같은 Discord 리소스도 `botClient.callBot('/internal/guilds/:id/resources')`로.
- `apps/bot/src/services/ports/discordGateway.djs.ts`만 discord.js 직접 사용. djs implementation은 봇 컨테이너에만 존재.
- Prisma client는 절대 `apps/bot/src/`나 `apps/dashboard/src/`에 직접 두지 않는다 — `packages/database`에서 export.
- env 변수는 `apps/{bot,dashboard}/src/lib/env.ts` 또는 `src/config/env.ts`에서 **zod로 한 번만 검증** 후 타입 export. `process.env` 직접 참조 금지.
- 한 파일 = 한 command/listener/interaction. Sapphire가 폴더 자동 로드한다.

---

## 4. 기능 로드맵 (MVP → MEE6 풀셋)

### Phase 0 — Bootstrap (D+0~3)

- 모노레포 스캐폴딩, ESLint/Prettier/Vitest/lefthook
- Discord Developer Portal 앱 등록, 개발 길드 1개 셋업
- `ping` 슬래시 커맨드로 hello world

### Phase 1 — Tickets (MVP, D+3~10)

**가장 가치 있는 기능. 첫 번째로.**

데이터 모델 (Prisma 시작점):

```prisma
model Panel {
  id              String   @id @default(cuid())
  guildId         String
  channelId       String
  messageId       String
  componentType   String   // 'button' | 'select'
  ticketCategoryId String  // Discord category to create channel in
  supportRoleIds  String[]
  namingScheme    String   // e.g. "ticket-{number}"
  perUserLimit    Int?     // null = unlimited
  formId          String?
  // ... embedColor, embedTitle, welcomeMessage 등
}

model Ticket {
  id            String   @id @default(cuid())
  guildId       String
  panelId       String
  channelId     String   @unique
  number        Int      // per-guild incrementing
  openerId      String
  claimedById   String?
  status        String   // 'open' | 'claimed' | 'closed'
  formAnswers   Json?
  openedAt      DateTime @default(now())
  claimedAt     DateTime?
  closedAt      DateTime?
  closeReason   String?
  transcriptUrl String?
  @@unique([guildId, openerId, panelId, status])  // 동시성 가드
}
```

**구현 체크리스트:**

- [ ] `/panel create` 슬래시 — 카테고리/role/템플릿 입력
- [ ] 패널 메시지 (버튼) → `interaction.showModal()` (선택적 5문항) → 채널 생성
- [ ] 채널 생성: `ChannelManager.create(GUILD_TEXT, parent: categoryId, permissionOverwrites)`. `@everyone` deny VIEW_CHANNEL, opener + supportRoles allow
- [ ] `/claim` `/close` `/add` `/remove` `/transfer`
- [ ] **동시성 처리**: 같은 유저 버튼 더블클릭 → `INSERT ... ON CONFLICT` 또는 Redis lock (`SET nx ex 5`)
- [ ] **고아 채널 정리**: `ChannelDelete` 이벤트 → ticket status sync
- [ ] **카테고리 50채널 제한**: overflow 시 `private thread` 모드 폴백
- [ ] Transcript: 메시지 dump JSON → S3/R2 업로드 + 첨부 download (24h 만료 전에 mirror)

### Phase 2 — Moderation + AutoMod (D+10~17)

- 명령: `warn`, `mute`(timeout API), `kick`, `ban`/`unban`, `softban`, `clean`
- ModCase 테이블 + case number per guild
- Modlog 채널
- Native AutoMod 연동 + 봇 자체 룰 (regex, mention spam, fast-message rate, invite block)
- Anti-raid: 가입 속도 임계치, 신규 계정 차단

### Phase 3 — Self Roles + Welcome (D+17~22)

- 버튼/SelectMenu 기반 role menu (reaction roles는 레거시, 미지원)
- Exclusivity: none/single/multi (min~max)
- Welcome: 채널 + DM, 변수 치환 (`{user}`, `{server}`, `{membercount}`), autorole

### Phase 4 — Leveling + Logging (D+22~30)

- XP: 메시지당 base + 길이 보너스, per-channel 60s 쿨다운 (Redis), no-XP 채널/role
- Role rewards by level
- Leaderboard (Redis sorted set + 매시간 PG sync)
- Logging: MessageDelete/Update/BulkDelete, MemberAdd/Remove/Update, RoleCreate/Delete, ChannelCreate/Delete, VoiceStateUpdate, BanAdd/Remove, ThreadCreate/Delete — 이벤트별 채널 라우팅

### Phase 5 — 기타 (D+30+)

Custom commands, reminders, giveaways, polls (native API), feeds (YouTube/Twitch/RSS), verification (캡차).

---

## 5. 코드 작성 규칙 (Claude Code 행동 지침)

### 절대 하지 말 것

- ❌ `client.on('messageCreate', ...)` 직접 작성 — `apps/bot/src/listeners/`에 파일로
- ❌ `process.env.X` 직접 참조 — `config/env.ts`의 typed env 통해서만
- ❌ Prisma client를 `apps/bot/src/` 내에서 `new PrismaClient()` — `packages/database` 통해서
- ❌ `console.log` — `pino` 사용 (`container.logger`)
- ❌ Discord.js 객체를 service 메서드 1차 인자로 — primitive (id, content) 만 받기
- ❌ Components V2 message flag (32768) 사용 — v1에선 레거시 embeds만
- ❌ 음악 기능 추가 — 범위 밖
- ❌ `git commit --no-verify`, `--amend` 후 push — 항상 새 커밋
- ❌ `Co-Authored-By: Claude` 태그 — Daniel 글로벌 규칙
- ❌ **토큰/시크릿 커밋 금지** — `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`, `DATABASE_URL`(비밀번호 포함), GCP 서비스 키, Sentry DSN, 그 외 모든 자격증명. **이 레포는 PUBLIC**이라 한 번이라도 커밋되면 git history에서 영구 노출됨. `.env*`는 모두 `.gitignore`에, `.env.example`만 placeholder 값으로 커밋. 의심스러우면 커밋 전에 반드시 `git diff --staged | grep -iE "(token|secret|key|password|dsn)"` 체크.

### 항상 할 것

- ✅ 새 슬래시 커맨드 = `apps/bot/src/commands/<domain>/<name>.ts` 파일 1개 + Sapphire `Command` 상속
- ✅ 새 버튼/모달 = `interactions/buttons/<id>.ts` (customId prefix로 라우팅)
- ✅ 비즈니스 로직 = `services/`에 (테스트 가능한 형태)
- ✅ Discord API 권한 변경/추가 = README의 invite URL scope 갱신
- ✅ 신규 기능 = `docs/features/<name>.md` 스펙 먼저 → ADR(필요시) → 코드
- ✅ 모든 외부 입력 = zod 검증
- ✅ 모든 PR = Changesets entry (`pnpm changeset`)
- ✅ Conventional Commits (`feat(tickets):`, `fix(moderation):`, `chore(deps):`)
- ✅ **Git/GH identity: 개인 계정 — `GrapeInTheTree` (GitHub) / `Rightruth` <`rightruth1202@gmail.com`> (commit)**
- ✅ **`gh` 명령 사용 전 항상 `gh auth status`로 active account 확인** — 머신에 회사 계정(`euijin-ahn_chilizgr`)도 동시 로그인돼 있어서 active가 그쪽으로 잘못 남아있을 수 있음. 잘못돼 있으면 `gh auth switch --user GrapeInTheTree`로 전환 후 진행.
- ❌ 회사 계정(`euijin-ahn_chilizgr` / `euijin.ahn@kayen.finance`) 사용 금지 — 이 프로젝트는 개인 사이드 운영

---

## 6. 운영·환경

### 6.1 Redis는 언제 도입하나 (현재: 미사용)

**v1~3 (Tickets/Moderation/Roles/Welcome)**: Redis **불필요**.

- 동시성 가드 → Postgres unique constraint (`@@unique([guildId, openerId, panelId, status])`)
- 짧은 lock → Postgres advisory lock (`SELECT pg_try_advisory_lock(...)`)
- 인메모리로 충분한 것 → AutoMod 슬라이딩 윈도우, slash command 쿨다운 (단일 인스턴스 가정)

**v4 (Leveling/Reminders/Giveaways)부터 도입 검토:**

- BullMQ 잡 큐 — 재시작에도 살아남아야 하는 지연 작업 (autoUnmute 1주일 후 등)
- XP 쿨다운 분산 — multi-shard 갈 때
- Anti-spam — 분산 카운터

**도입 트리거:** (a) reminder/giveaway가 사용자 가시 기능에 들어갈 때, (b) shard 2개 이상 갈 때, (c) deploy 시 in-flight job 유실이 운영상 문제될 때 — 셋 중 하나 발생 시 Phase 4에서 추가.

### 6.2 로컬 개발

- 개발 길드 1개 (Daniel 소유, ID는 `.env.local`)
- `pnpm dev` → `tsx watch apps/bot/src/index.ts`
- DB: 로컬 PostgreSQL (docker-compose의 `postgres` 서비스 재사용)
- Discord token 분리: `DISCORD_TOKEN_DEV`, `DISCORD_TOKEN_PROD`

### 6.3 배포 — GCP Compute Engine + docker-compose

**왜 Cloud Run이 아닌가:** Discord 봇은 Discord Gateway에 영구 WebSocket 연결을 유지해야 함. Cloud Run은 본질적으로 request-driven (60min 타임아웃, scale-to-zero 기본). min-instances=1 + alwaysCPU=true로 강제하면 작동은 하지만 VM보다 비싸고 cold start 위험. 표준은 VM.

**구성 (예상 비용 ~$15-25/mo):**

```
GCP Compute Engine VM (e2-small, ubuntu-22.04-lts)
├── nginx + certbot                       # 호스트에서 TLS 종료 (operator's existing setup)
│   └── bot-dashboard.fanx.xyz → 127.0.0.1:3200
└── docker-compose
    ├── bot         (apps/bot, multi-stage)         → 127.0.0.1:${BOT_HEALTH_PORT:-3100}
    ├── dashboard   (apps/dashboard, Next.js)       → 127.0.0.1:${DASHBOARD_PORT:-3200}
    └── postgres    (postgres:16-alpine + volume)   → 127.0.0.1:${POSTGRES_PORT:-5433}
    # redis는 Phase 4에서 추가 (이미지 슬롯 hearth-cache:local 예약됨)
```

**호스트 포트 계획 (전부 127.0.0.1 바인딩, 외부 노출은 nginx만):**

| 서비스      | 호스트 포트 | env override      | 용도                         |
| ----------- | ----------- | ----------------- | ---------------------------- |
| 봇 internal | 3100        | `BOT_HEALTH_PORT` | `/healthz` + `/internal/*`   |
| 대시보드    | 3200        | `DASHBOARD_PORT`  | nginx upstream               |
| postgres    | 5433        | `POSTGRES_PORT`   | 호스트 native pg와 충돌 회피 |

**선택지 (Postgres 위치):**

- **A. compose 안에 같이** — 가장 저렴, 백업은 직접 (`pg_dump` cron + GCS 업로드)
- **B. Cloud SQL db-f1-micro 분리** — 자동 백업/패치, +$10/mo

→ **시작은 A**. 봇 데이터 잃으면 곤란해지는 시점(유저 XP/티켓 이력 누적 후) Cloud SQL로 마이그레이션.

**파일 레이아웃:**

```
infra/
├── docker-compose.yml         # 단일 — dev: `up -d postgres`, prod: `up -d --build`
└── deploy.sh                  # VM에서 git pull + docker compose build + up -d
```

**배포 흐름 (registry-less, VM이 직접 빌드):**

1. PR merge → main
2. CI 검증: typecheck/lint/test/build + Dockerfile 빌드 검증 (push X)
3. VM에서 `deploy.sh` 실행 (수동 SSH 또는 webhook) → `git pull && docker compose build bot && up -d`
4. 헬스체크 — `/healthz` HTTP 엔드포인트 + Discord ready 이벤트

→ **GHCR / 외부 registry 미사용**. VM이 Dockerfile로 직접 빌드. 단순 + registry 자격증명 불필요.

**비밀 관리:**

- VM의 `.env` 파일 (소유자 root, 600) — 가장 단순
- 추후 Secret Manager로 이행 (`gcloud secrets versions access` → entrypoint에서 export)

### 6.4 CI/CD

- GitHub Actions: lint + typecheck + test + Dockerfile 빌드 검증 on PR/push
- Changesets PR으로 버전 자동 관리
- 인프라팀 의존성 없음 — 개인 GCP 프로젝트로 단독 운영
- Image registry 사용 안 함 (VM에서 직접 빌드)

### 6.5 비밀 관리 (PUBLIC repo 주의)

**이 레포는 GitHub PUBLIC**. 한 번 커밋되면 git history에 영구 — `git rm` 해도 이전 커밋에 남음. 자격증명 노출 시 즉시 rotation 필요.

**규칙:**

- `.gitignore`에 처음부터 포함: `.env`, `.env.*`, `!.env.example`, `*.pem`, `*.key`, `service-account*.json`
- 커밋 전 자가검증: `git diff --staged | grep -iE "(token|secret|key|password|bearer|dsn|api[_-]?key)"`
- pre-commit hook(lefthook)에 `gitleaks` 또는 동등 스캐너 통합 (Phase 0에서 셋업)
- `.env.example`는 키 이름만 `KEY=`, 값은 비우거나 `xxx`/`changeme`. 진짜 token 의 일부라도 절대 금지
- Discord token이 노출됐다면 Discord Developer Portal → "Reset Token" 즉시. DB 비번 노출 시 `ALTER USER ... PASSWORD ...`

**저장 위치:**

- 로컬 개발: `apps/bot/.env.local`, `apps/dashboard/.env.local` (gitignored)
- Production (VM): `apps/bot/.env`, `apps/dashboard/.env` (root:root 600, docker-compose `env_file:` 참조). 대시보드 도입 후부터 양쪽 모두 필요
- Phase 후반 GCP Secret Manager로 이행 — `gcloud secrets versions access` → entrypoint에서 export

**대시보드 도입 후 추가된 시크릿 (Phase 2):**

- `INTERNAL_API_TOKEN` — 봇과 대시보드가 공유하는 bearer 토큰. **양쪽 .env에 같은 값**. 생성: `openssl rand -hex 32`. mismatch 시 모든 대시보드 mutation이 401. `infra/deploy.sh`가 자동 검증
- `NEXTAUTH_SECRET` — 대시보드 JWT 서명. 생성: `openssl rand -base64 32`. rotate = regen + dashboard 재시작
- `DISCORD_CLIENT_SECRET` — Discord OAuth 클라이언트 시크릿. 봇 토큰과는 별도

---

## 7. 참고 출처 (검증된 것만)

- discord.js v14.26 — https://github.com/discordjs/discord.js/releases (2026-04-14)
- Sapphire Framework — https://www.sapphirejs.dev/
- discord.js guide (코드 구조) — https://discordjs.guide/creating-your-bot/main-file.html
- Discord Platform Changelog — https://docs.discord.com/developers/change-log
- Components V2 reference — https://docs.discord.com/developers/components/reference
- Sharding guide — https://discordjs.guide/sharding/
- Prisma 7 GA — https://www.prisma.io/blog/announcing-prisma-orm-7-0-0
- Prisma 7 upgrade guide — https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
- Prisma perf 벤치 — https://www.prisma.io/blog/performance-benchmarks-comparing-query-latency-across-typescript-orms-and-databases
- Sapphire examples (`with-typescript-complete`) — https://github.com/sapphiredev/examples
- Uniswap interface (Nx + lefthook + oxlint) — https://github.com/Uniswap/interface
- Uniswap sdks (Turborepo + Changesets) — https://github.com/Uniswap/sdks
- Vercel AI (Turborepo + pnpm + Vitest 4) — https://github.com/vercel/ai
- YAGPDB 기능 카탈로그 — https://help.yagpdb.xyz/docs/
- Discord Tickets (oss reference) — https://github.com/discord-tickets/bot

---

## 8. 진행 상황

**현재 상태 (2026-04-28 — Dashboard MVP ✅ 완료):**

- ✅ **Phase 0**: 모노레포 스캐폴딩 + Sapphire bootstrap + multi-entry tsup + 전 quality gate. FanX `Kayen Test Sever`에서 `/ping` 응답. 함정 16건: vault `03_troubleshooting/01-phase-0-gotchas.md`
- ✅ **Phase 1**: 5 PR + post-Phase-1 fix 7 commits. 티켓 lifecycle (open/claim/close/reopen/delete) E2E 검증. unit 82/82 + integration 5/5 (testcontainers pg 16) green. 함정 9건: vault `03_troubleshooting/02-phase-1-gotchas.md`
- ✅ **PR-6 (Multi-type panel)**: 1 panel = N 버튼. `/panel ticket-type {add, edit, remove}` 슬래시. operator-driven type 추가/수정/삭제 (코드 0 변경). Discord 네이티브 role picker
- ✅ **Phase 2: Web Dashboard MVP (PR-1~7)**: bot + 대시보드가 같은 VM에 단일 compose stack으로. Path C (self-host, Vercel/Neon X) 채택.
  - PR-1: `@hearth/tickets-core` 추출 — 양쪽이 같은 services + zod schemas + i18n 사용. discord-api-types만, discord.js runtime 의존 0
  - PR-2: 봇 internal HTTP API — `/healthz`, `/internal/guilds/list`, `/internal/guilds/:id/resources`, `POST /internal/panels/:id/render`, `DELETE /internal/panels/:id`. bearer auth (timingSafeEqual)
  - PR-3: dashboard skeleton — Next.js 15 + Tailwind v4 + shadcn/ui + Auth.js v5 (Discord OAuth, identify+guilds), edge-compatible middleware (cookie 체크만), 페이지: /login, /select-guild, /g/[id]
  - PR-4: panels CRUD — list / new / detail / edit, 라이브 embed preview, sessionStorage 폼 상태, graceful degradation (봇 다운 시 DB commit + Retry sync 버튼)
  - PR-5: ticket types CRUD — chip-style RoleMultiPicker, 9-필드 form, removal blocked by tickets (slash와 동일 conflict copy)
  - PR-6: tickets read-only + settings (archive category, log channel)
  - PR-7: dashboard Dockerfile + compose 갱신 (image rename `hearth-bot:local` + `hearth-dashboard:local`, env-driven 호스트 포트), nginx 예시, deploy.sh `INTERNAL_API_TOKEN` 일치 검증, runbook
- ✅ **로컬 docker 검증** (2026-04-28): 시크릿 창 OAuth → guild picker → panel/type/settings CRUD. 두 함정 처리 — Auth.js의 `useSecureCookies`가 NODE_ENV=production + http에서 `__Secure-` 쿠키 prefix 박아 PKCE 깨짐 → URL scheme 기반으로 분기 (`fix(core): scope Auth.js secure cookies to https NEXTAUTH_URL`). 폼 검증이 서버에 가서야 실패하는 UX → react-hook-form + zodResolver로 client-side onChange 검증 + inline 에러 카피, schemas는 `@hearth/tickets-core/schemas` subpath로 import (배럴은 pg/dns/net 끌고 와서 webpack 폭발)
- ✅ **테스트 누계**: bot 28 unit + tickets-core 94 unit + dashboard 40 unit + bot 5 integration. 전부 green
- 🚧 **PM Support Test 서버 검증**: 봇 lifecycle (PR-6 시점) 검증 완료. 대시보드 검증은 VM 배포 후

**검증된 권한 모델 (PM 합의, 2026-04-28):**

| 액션        | 권한                                   |
| ----------- | -------------------------------------- |
| Open ticket | 모든 user (panel 채널 access만 있으면) |
| Close       | opener OR support role                 |
| Claim       | support role only                      |
| Reopen      | support role only                      |
| Delete      | admin (Manage Guild) only              |

**Discord button visibility 한계 (PM 안내됨):** welcome 메시지의 4 버튼은 채널 view 권한 있는 모두에게 보임 (Discord platform 제약 — per-viewer 렌더 불가). 권한 차단은 service 레벨에서 ephemeral 에러로 처리. MEE6 / Tickety / Fannie 동일 패턴.

**Phase 1 + PR-6 누적 함정 (vault `03_troubleshooting/02-phase-1-gotchas.md`):**

- `@prisma/client@7` default entry는 CJS — Node ESM의 cjs-module-lexer가 named export 정적 분석 못 함. **해법**: 새 `prisma-client` ESM generator로 전환
- Sapphire `InteractionHandlerStore`는 `interaction-handlers/` (하이픈)만 스캔. `interactions/`로 짜놨더니 모든 button/modal 무응답 → **해법**: 디렉토리 rename
- Sapphire piece 1 file = 1 class. 한 파일에 listener 두 개 export하면 두 번째는 silent fail → **해법**: 파일 분할
- `Precondition.name` 명시 필수 (filename fallback 위험)
- `ChatInputCommandDenied` 이벤트 listener 필수 (Sapphire 자동 응답 X → "application did not respond")
- DEV_GUILD_ID 변경 후 Sapphire가 in-memory 캐시 때문에 새 guild에 push skip → **해법**: `docker compose down bot` 후 `up -d` (full recreate)

**Phase 1.1 backlog (deferred, 상세: vault `02_implementation/07-ticket-backlog.md`):**

- **Transcript** — delete 시 HTML dump → modlog file attach (close 시점 X, S3 X)
- **`/add` `/remove`** — 티켓 채널에 user/role 추가·제거, support only
- **`/transfer`** — claim 재할당, support only (opener는 fact라 안 바뀜)

PM/운영자 요청 들어오거나 정식 Phase 1.1 마감 시 PR-7로 묶어서.

**다음 할 일:**

1. **VM 배포** — `bot-dashboard.fanx.xyz` 서브도메인 DNS A 레코드 + nginx site config + certbot. 운영 런북: `docs/runbook/02-dashboard-deploy.md`. `INTERNAL_API_TOKEN` (양쪽 .env 동일) + `NEXTAUTH_SECRET` 생성, Discord OAuth redirect URI 등록
2. **PM 검증** — 대시보드에서 panel/type CRUD 끝까지 돌려보기. 그 후 production guild 본격 운영
3. **Phase 3 (Moderation + AutoMod)** — warn/mute/kick/ban + native AutoMod hook + dashboard 모더레이션 페이지

**막힌 것 / 대기 중:**

- (운영) `bot-dashboard.fanx.xyz` DNS 레코드 설정 — 팀이 fanx.xyz 도메인 owner라 Daniel이 요청 보낸 후
- (장기) GCP 프로젝트 ID — 팀 프로젝트로 배포 예정. 현재 로컬에서 docker compose build로만 검증
- (Phase 1.1) Transcript / `/add` `/remove` / `/transfer` — PM 요청 시 단일 PR로 묶어서

---

## 9. Daniel 컨텍스트 (글로벌 CLAUDE.md 보완)

- 주 언어 TypeScript / Solidity. 디스코드 봇은 신규 도메인이지만 NestJS·ethers 익숙 → service-layer 분리 패턴 친숙.
- Obsidian vault: `/Users/ahn_euijin/Desktop/01_vault/10_study-with-agents/02_projects/hearth/` (2026-04-28 `discord-bot/` → `hearth/` 폴더 rename 완료). 메모리 폴더 `~/.claude/projects/-Users-ahn-euijin-discord-bot/`는 로컬 repo 경로에서 자동 파생 — 로컬 dir 이름 (`/Users/ahn_euijin/discord-bot/`) 그대로 두어서 메모리 경로 변경 X.
- **3곳 sync 규칙 (절대):** 플랜·결정 확정 시 (a) 레포 CLAUDE.md, (b) 프로젝트 메모리(`~/.claude/projects/-Users-ahn-euijin-discord-bot/memory/`), (c) Obsidian vault 셋 모두 즉시 갱신. 한 곳만 갱신하면 다음 세션이 stale 가정으로 시작.
- 다른 진행 프로젝트: chiliz-buyback (production), kayenfi-limit-order-api (유지보수). 컨텍스트 스위칭 시 두 프로젝트 모두 active 상태.
