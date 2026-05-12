// Vitest setup for reaction-roles-core. We don't read env in reaction-roles-core
// itself, but @hearth/database's client modules validate DATABASE_URL on
// first access. A stub is enough — service tests run against PGlite (no
// Postgres connection), so the real `dbDrizzle` Proxy is never invoked.

process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test';
process.env['NODE_ENV'] ??= 'test';
