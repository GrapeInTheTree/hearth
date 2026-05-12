// Vitest setup for role-picker-core. Stubs DATABASE_URL so the lazy
// dbDrizzle Proxy in @hearth/database doesn't fail validation when
// imported (we never actually invoke the proxy — service tests run
// against PGlite via tests/helpers/testDb).

process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test';
process.env['NODE_ENV'] ??= 'test';
