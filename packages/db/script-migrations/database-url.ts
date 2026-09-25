/** Matches the main migrator: an empty optional direct DSN falls back to DATABASE_URL. */
export function resolveMigrationDatabaseUrl(
  env: { MIGRATION_DATABASE_URL?: string; DATABASE_URL?: string } = {
    MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  }
): string | undefined {
  return env.MIGRATION_DATABASE_URL || env.DATABASE_URL
}
