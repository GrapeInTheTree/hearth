// Vitest setup for tickets-core. We don't read env in tickets-core itself,
// but @hearth/database's client validates DATABASE_URL at import time
// (driver-adapter pattern). A stub is enough — the unit tests use FakeDb,
// not the real Prisma client.

process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test';
process.env['NODE_ENV'] ??= 'test';
