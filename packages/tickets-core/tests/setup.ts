// Vitest setup for tickets-core. We don't read env in tickets-core itself,
// but @hearth/database's client modules validate DATABASE_URL on first
// access. A stub is enough — service tests run against PGlite (no
// Postgres connection), so the real `db`/`dbDrizzle` Proxies are never
// invoked.

process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test';
process.env['NODE_ENV'] ??= 'test';
