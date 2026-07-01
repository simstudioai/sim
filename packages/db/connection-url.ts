/**
 * Resolve a connection URL for the active DB role, preferring the role-keyed
 * variant (e.g. `DATABASE_URL_TRIGGER`) and falling back to the shared base.
 * Lets each deploy point its surface at its own Postgres user + PgBouncer via
 * env alone; unset keyed vars preserve the prior single-URL behavior.
 */
export function resolveDbUrl(
  base: 'DATABASE_URL' | 'DATABASE_REPLICA_URL',
  role: string
): string | undefined {
  return process.env[`${base}_${role.toUpperCase()}`] ?? process.env[base]
}
