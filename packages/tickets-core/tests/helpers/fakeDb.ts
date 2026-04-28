import { type DbClient, Prisma, TicketStatus } from '@discord-bot/database';

// In-memory Prisma-shaped fake. Implements only the methods our services
// actually call. We deliberately don't recreate Prisma's full surface —
// that's the integration test's job (PR-5 testcontainers). This keeps
// unit tests fast and the fake small enough to audit.

interface Tables {
  guildConfig: Map<string, GuildConfigRow>;
  panel: PanelRow[];
  panelTicketType: PanelTicketTypeRow[];
  ticket: TicketRow[];
  ticketEvent: TicketEventRow[];
}

interface GuildConfigRow {
  guildId: string;
  archiveCategoryId: string | null;
  alertChannelId: string | null;
  ticketCounter: number;
  defaultLocale: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PanelRow {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  embedTitle: string;
  embedDescription: string;
  embedColor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PanelTicketTypeRow {
  id: string;
  panelId: string;
  name: string;
  emoji: string;
  buttonStyle: string;
  buttonLabel: string | null;
  buttonOrder: number;
  activeCategoryId: string;
  supportRoleIds: string[];
  pingRoleIds: string[];
  perUserLimit: number | null;
  welcomeMessage: string | null;
}

interface TicketRow {
  id: string;
  guildId: string;
  panelId: string;
  panelTypeId: string;
  channelId: string;
  welcomeMessageId: string | null;
  number: number;
  openerId: string;
  claimedById: string | null;
  status: TicketStatus;
  openedAt: Date;
  claimedAt: Date | null;
  closedAt: Date | null;
  closedById: string | null;
  closeReason: string | null;
}

interface TicketEventRow {
  id: string;
  ticketId: string;
  type: string;
  actorId: string;
  metadata: unknown;
  createdAt: Date;
}

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${String(++idCounter)}`;
}

export interface FakeDbOptions {
  /** Force the next ticket.create to throw a P2002 (partial unique violation). */
  readonly p2002OnNextTicketCreate?: boolean;
}

export interface FakeDb extends DbClient {
  readonly tables: Tables;
  setOptions(opts: Partial<FakeDbOptions>): void;
  reset(): void;
}

export function createFakeDb(initialOpts: FakeDbOptions = {}): FakeDb {
  const tables: Tables = {
    guildConfig: new Map(),
    panel: [],
    panelTicketType: [],
    ticket: [],
    ticketEvent: [],
  };
  let opts: FakeDbOptions = { ...initialOpts };

  const guildConfig = {
    findUnique: ({ where }: { where: { guildId: string } }) =>
      Promise.resolve(tables.guildConfig.get(where.guildId) ?? null),
    upsert: ({
      where,
      create,
      update,
      select,
    }: {
      where: { guildId: string };
      create: Partial<GuildConfigRow> & { guildId: string };
      update: Partial<GuildConfigRow> | { ticketCounter?: { increment: number } };
      select?: { ticketCounter?: boolean };
    }) => {
      const existing = tables.guildConfig.get(where.guildId);
      const now = new Date();
      if (existing === undefined) {
        const row: GuildConfigRow = {
          guildId: where.guildId,
          archiveCategoryId: create.archiveCategoryId ?? null,
          alertChannelId: create.alertChannelId ?? null,
          ticketCounter: create.ticketCounter ?? 0,
          defaultLocale: create.defaultLocale ?? 'en',
          createdAt: now,
          updatedAt: now,
        };
        tables.guildConfig.set(where.guildId, row);
        return Promise.resolve(
          select?.ticketCounter === true ? { ticketCounter: row.ticketCounter } : row,
        );
      }
      // increment shape
      if (
        'ticketCounter' in update &&
        typeof update.ticketCounter === 'object' &&
        update.ticketCounter !== null
      ) {
        const inc = (update.ticketCounter as { increment: number }).increment;
        existing.ticketCounter += inc;
      } else {
        Object.assign(existing, update);
      }
      existing.updatedAt = now;
      return Promise.resolve(
        select?.ticketCounter === true ? { ticketCounter: existing.ticketCounter } : existing,
      );
    },
  };

  const panel = {
    findFirst: ({
      where,
      include,
    }: {
      where: Partial<PanelRow>;
      include?: { ticketTypes?: boolean };
    }) => {
      const found = tables.panel.find((p) =>
        Object.entries(where).every(([k, v]) => p[k as keyof PanelRow] === v),
      );
      if (found === undefined) return Promise.resolve(null);
      if (include?.ticketTypes === true) {
        return Promise.resolve({
          ...found,
          ticketTypes: tables.panelTicketType.filter((t) => t.panelId === found.id),
        });
      }
      return Promise.resolve(found);
    },
    findUnique: ({
      where,
      include,
    }: {
      where: { id: string };
      include?: { ticketTypes?: boolean };
    }) => {
      const found = tables.panel.find((p) => p.id === where.id);
      if (found === undefined) return Promise.resolve(null);
      if (include?.ticketTypes === true) {
        return Promise.resolve({
          ...found,
          ticketTypes: tables.panelTicketType.filter((t) => t.panelId === found.id),
        });
      }
      return Promise.resolve(found);
    },
    findMany: ({ where }: { where: Partial<PanelRow>; orderBy?: unknown }) => {
      return Promise.resolve(
        tables.panel.filter((p) =>
          Object.entries(where).every(([k, v]) => p[k as keyof PanelRow] === v),
        ),
      );
    },
    create: ({
      data,
    }: {
      data: Omit<PanelRow, 'id' | 'createdAt' | 'updatedAt' | 'embedColor'> & {
        embedColor?: string | null;
      };
    }) => {
      const now = new Date();
      const row: PanelRow = {
        id: nextId('panel'),
        embedColor: data.embedColor ?? null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      tables.panel.push(row);
      return Promise.resolve(row);
    },
    update: ({ where, data }: { where: { id: string }; data: Partial<PanelRow> }) => {
      const row = tables.panel.find((p) => p.id === where.id);
      if (row === undefined) throw new Error(`panel ${where.id} not found`);
      Object.assign(row, data, { updatedAt: new Date() });
      return Promise.resolve(row);
    },
  };

  const panelTicketType = {
    findFirst: ({ where }: { where: Partial<PanelTicketTypeRow> }) =>
      Promise.resolve(
        tables.panelTicketType.find((t) =>
          Object.entries(where).every(([k, v]) => t[k as keyof PanelTicketTypeRow] === v),
        ) ?? null,
      ),
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(tables.panelTicketType.find((t) => t.id === where.id) ?? null),
    findMany: ({ where }: { where: Partial<PanelTicketTypeRow> }) =>
      Promise.resolve(
        tables.panelTicketType.filter((t) =>
          Object.entries(where).every(([k, v]) => t[k as keyof PanelTicketTypeRow] === v),
        ),
      ),
    create: ({ data }: { data: Omit<PanelTicketTypeRow, 'id'> }) => {
      const row: PanelTicketTypeRow = { id: nextId('type'), ...data };
      tables.panelTicketType.push(row);
      return Promise.resolve(row);
    },
    update: ({ where, data }: { where: { id: string }; data: Partial<PanelTicketTypeRow> }) => {
      const row = tables.panelTicketType.find((t) => t.id === where.id);
      if (row === undefined) throw new Error(`panelTicketType ${where.id} not found`);
      Object.assign(row, data);
      return Promise.resolve(row);
    },
    delete: ({ where }: { where: { id: string } }) => {
      const idx = tables.panelTicketType.findIndex((t) => t.id === where.id);
      if (idx < 0) throw new Error(`panelTicketType ${where.id} not found`);
      const [row] = tables.panelTicketType.splice(idx, 1);
      return Promise.resolve(row);
    },
  };

  const ticket = {
    findFirst: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(matchTicket(tables.ticket, where) ?? null),
    findUnique: ({
      where,
      include,
    }: {
      where: { id?: string; channelId?: string };
      include?: { events?: unknown };
    }) => {
      const found = tables.ticket.find(
        (t) =>
          (where.id !== undefined && t.id === where.id) ||
          (where.channelId !== undefined && t.channelId === where.channelId),
      );
      if (found === undefined) return Promise.resolve(null);
      if (include?.events !== undefined) {
        return Promise.resolve({
          ...found,
          events: tables.ticketEvent
            .filter((e) => e.ticketId === found.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        });
      }
      return Promise.resolve(found);
    },
    findUniqueOrThrow: ({ where }: { where: { id: string } }) => {
      const found = tables.ticket.find((t) => t.id === where.id);
      if (found === undefined) throw new Error(`Ticket ${where.id} not found`);
      return Promise.resolve(found);
    },
    create: ({
      data,
    }: {
      data: Omit<
        TicketRow,
        | 'id'
        | 'openedAt'
        | 'claimedAt'
        | 'closedAt'
        | 'closedById'
        | 'closeReason'
        | 'welcomeMessageId'
        | 'claimedById'
      > &
        Partial<TicketRow>;
    }) => {
      if (opts.p2002OnNextTicketCreate === true) {
        opts = { ...opts, p2002OnNextTicketCreate: false };
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        });
      }
      // Enforce partial unique semantics for race tests.
      if (
        tables.ticket.some(
          (t) =>
            t.guildId === data.guildId &&
            t.openerId === data.openerId &&
            t.panelTypeId === data.panelTypeId &&
            (t.status === TicketStatus.open || t.status === TicketStatus.claimed),
        )
      ) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        });
      }
      const row: TicketRow = {
        id: nextId('ticket'),
        welcomeMessageId: null,
        claimedById: null,
        status: TicketStatus.open,
        openedAt: new Date(),
        claimedAt: null,
        closedAt: null,
        closedById: null,
        closeReason: null,
        ...data,
      } as TicketRow;
      tables.ticket.push(row);
      return Promise.resolve(row);
    },
    update: ({ where, data }: { where: { id: string }; data: Partial<TicketRow> }) => {
      const row = tables.ticket.find((t) => t.id === where.id);
      if (row === undefined) throw new Error(`ticket ${where.id} not found`);
      Object.assign(row, data);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: { where: Record<string, unknown>; data: Partial<TicketRow> }) => {
      const rows = tables.ticket.filter((t) => matchesWhere(t, where));
      for (const r of rows) Object.assign(r, data);
      return Promise.resolve({ count: rows.length });
    },
    delete: ({ where }: { where: { id: string } }) => {
      const idx = tables.ticket.findIndex((t) => t.id === where.id);
      if (idx < 0) throw new Error(`ticket ${where.id} not found`);
      const [row] = tables.ticket.splice(idx, 1);
      // Cascade: delete events too.
      tables.ticketEvent = tables.ticketEvent.filter((e) => e.ticketId !== where.id);
      return Promise.resolve(row);
    },
    count: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(tables.ticket.filter((t) => matchesWhere(t, where)).length),
  };

  const ticketEvent = {
    create: ({ data }: { data: Omit<TicketEventRow, 'id' | 'createdAt'> }) => {
      const row: TicketEventRow = {
        id: nextId('evt'),
        createdAt: new Date(),
        ...data,
      };
      tables.ticketEvent.push(row);
      return Promise.resolve(row);
    },
  };

  // $transaction(fn): run fn synchronously with this same client. Tests don't
  // exercise rollback semantics — that's integration territory.
  const $transaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client);
  const $executeRaw = (() => Promise.resolve(0)) as unknown;
  const $executeRawUnsafe = (() => Promise.resolve(0)) as unknown;
  const $disconnect = () => Promise.resolve();

  const client = {
    guildConfig,
    panel,
    panelTicketType,
    ticket,
    ticketEvent,
    $transaction,
    $executeRaw,
    $executeRawUnsafe,
    $disconnect,
    tables,
    setOptions: (next: Partial<FakeDbOptions>) => {
      opts = { ...opts, ...next };
    },
    reset: () => {
      tables.guildConfig.clear();
      tables.panel.length = 0;
      tables.panelTicketType.length = 0;
      tables.ticket.length = 0;
      tables.ticketEvent.length = 0;
      idCounter = 0;
      opts = { ...initialOpts };
    },
  };

  return client as unknown as FakeDb;
}

function matchTicket(rows: TicketRow[], where: Record<string, unknown>): TicketRow | undefined {
  return rows.find((t) => matchesWhere(t, where));
}

function matchesWhere(t: TicketRow, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'status' && typeof v === 'object' && v !== null && 'in' in v) {
      const allowed = (v as { in: TicketStatus[] }).in;
      if (!allowed.includes(t.status)) return false;
      continue;
    }
    if (t[k as keyof TicketRow] !== v) return false;
  }
  return true;
}
