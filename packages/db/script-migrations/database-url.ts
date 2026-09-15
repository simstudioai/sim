/** Matches the main migrator: an empty optional direct DSN falls back to DATABASE_URL. */
export function resolveMigrationDatabaseUrl(
  env: { MIGRATION_DATABASE_URL?: string; DATABASE_URL?: string } = process.env
): string | undefined {
  return env.MIGRATION_DATABASE_URL || env.DATABASE_URL
}
