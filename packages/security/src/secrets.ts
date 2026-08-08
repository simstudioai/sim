/**
 * Guards against config layers that hand an app a secret which is not one.
 *
 * `$(openssl rand -hex 32)` reads as "generate a random secret", but neither Docker
 * Compose's `environment:` interpolation nor a `.env` file runs a shell: compose-go's
 * template grammar matches `$VAR`, `${VAR}` and `$$` only, so `$(` matches nothing, no
 * error is raised, and the container receives the command text verbatim. Every deployment
 * started that way shares one secret published in the repository — and for
 * `BETTER_AUTH_SECRET` that is the HMAC key behind deployment auth cookies, unsubscribe
 * tokens, and Better Auth's signed session cookie cache.
 */

/** Env vars whose value is a secret, so a shared or fake value is a vulnerability. */
export const SECRET_ENV_KEYS = [
  'BETTER_AUTH_SECRET',
  'ENCRYPTION_KEY',
  'API_ENCRYPTION_KEY',
  'INTERNAL_API_SECRET',
  'INTERNAL_JWT_SECRET',
  'CRON_SECRET',
] as const

/**
 * Command substitution only. `${VAR}` is deliberately not matched: it is valid Compose
 * grammar that does get expanded, so its presence proves nothing, and rejecting it would
 * refuse an operator passphrase that happens to contain those characters.
 */
const SHELL_SUBSTITUTION = /\$\(|`/

export function hasUnexpandedShellSubstitution(value: string): boolean {
  return SHELL_SUBSTITUTION.test(value)
}

/**
 * Throws when a present secret carries unexpanded shell syntax. Absent and empty values
 * pass — this reports corruption, not absence, so it cannot fail an unconfigured build.
 *
 * The message quotes the offending value: it is a literal published in a config file
 * rather than a real secret, and seeing it is what makes the failure self-explanatory.
 */
export function assertUsableSecrets(candidates: Record<string, string | undefined>): void {
  const unusable = Object.entries(candidates).filter(
    ([, value]) => value && hasUnexpandedShellSubstitution(value)
  )
  if (unusable.length === 0) return

  const details = unusable.map(([name, value]) => `  ${name}=${value}`).join('\n')
  throw new Error(
    `Refusing to start: ${unusable.length} secret(s) hold an unexpanded shell substitution ` +
      `rather than a value.\n${details}\n` +
      'Neither Docker Compose nor a .env file runs a shell over these, so the text above is ' +
      'the literal value in use and is not secret. Generate real values with ' +
      '`openssl rand -hex 32` and set them directly.'
  )
}
