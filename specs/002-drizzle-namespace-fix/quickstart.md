# Quickstart: Namespace Resolution for Migrations

## Goal

Verify that unqualified schema references resolve to the primary backend default schema while the reference backend remains unchanged.

## Verification Steps

### 1. Primary Backend (IRIS) Configuration
- Set `DB_TYPE=iris`
- Set `DB_DEFAULT_SCHEMA=MyDefaultSchema`
- Run migrations: `bun run db:migrate` in `packages/db`
- Verify in IRIS that tables are created in `MyDefaultSchema`
- Verify that `__drizzle_migrations` table is in `drizzle` schema (or as specified by `DB_METADATA_SCHEMA`)

### 2. Reference Backend (PostgreSQL) Configuration
- Set `DB_TYPE=postgres` (or leave unset)
- Run migrations: `bun run db:migrate`
- Verify tables are created in the `public` schema (default behavior)

### 3. Runtime Verification
- Start the app with `DB_TYPE=iris` and `DB_DEFAULT_SCHEMA=MyDefaultSchema`
- Execute a query through Drizzle
- Verify the search path is set correctly: `SHOW search_path` should include `MyDefaultSchema`
