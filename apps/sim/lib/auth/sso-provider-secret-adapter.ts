import type { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  decryptProviderConfig,
  encryptProviderConfig,
  type SsoConfigColumn,
} from '@/lib/auth/sso-provider-secrets'

type BetterAuthAdapter = ReturnType<ReturnType<typeof drizzleAdapter>>

const SSO_PROVIDER_MODEL = 'ssoProvider'
const SECRET_COLUMNS: readonly SsoConfigColumn[] = ['oidcConfig', 'samlConfig']

/**
 * Encrypts the secrets inside `sso_provider.oidc_config` / `saml_config` at the
 * database adapter, and decrypts them on the way back out.
 *
 * The adapter is the only seam that covers both directions. Better Auth's SSO
 * plugin owns the sign-in path end to end: it loads the provider row itself and
 * passes `oidcConfig.clientSecret` straight into the authorization URL and the
 * token exchange, so encrypting writes anywhere else would break every sign-in.
 * Registration, the plugin's own update merge, and sign-in all pass through
 * here, which keeps one encoding for all of them.
 *
 * Only the secret fields are encrypted, not the whole column, so the JSON stays
 * parseable for the readers that want the public parts of the config. Reads
 * tolerate values stored before this existed; see `provider-secrets.ts`.
 *
 * Sim also reads and writes these columns directly with Drizzle in a few places
 * that bypass this adapter — the register route's reuse and rollback branches,
 * the providers list, and the operator registration script — and each of those
 * handles the envelope itself.
 *
 * Transactions are wrapped recursively so writes inside `adapter.transaction(...)`
 * callbacks go through the same encoding.
 */
export function encryptSsoProviderSecrets(adapter: BetterAuthAdapter): BetterAuthAdapter {
  const guarded: BetterAuthAdapter = {
    ...adapter,
    ...encryptSecretSurface(adapter),
  }

  const transaction = adapter.transaction
  if (typeof transaction === 'function') {
    guarded.transaction = (callback) =>
      transaction((trx) => callback({ ...trx, ...encryptSecretSurface(trx) }))
  }

  return guarded
}

type SecretSurface = Pick<
  BetterAuthAdapter,
  'create' | 'update' | 'findOne' | 'findMany' | 'consumeOne' | 'incrementOne'
>

function encryptSecretSurface<TAdapter extends SecretSurface>(adapter: TAdapter): SecretSurface {
  return {
    create: async (input) => {
      if (input.model !== SSO_PROVIDER_MODEL) return adapter.create(input)
      const data = await encryptColumns(input.data as Record<string, unknown>)
      return decryptRow(await adapter.create({ ...input, data: data as never })) as never
    },
    update: async (input) => {
      if (input.model !== SSO_PROVIDER_MODEL) return adapter.update(input)
      const update = await encryptColumns(input.update as Record<string, unknown>)
      return decryptRow(await adapter.update({ ...input, update: update as never })) as never
    },
    findOne: async (input) => {
      const row = await adapter.findOne(input)
      return (input.model === SSO_PROVIDER_MODEL ? await decryptRow(row) : row) as never
    },
    findMany: async (input) => {
      const rows = await adapter.findMany(input)
      if (input.model !== SSO_PROVIDER_MODEL || !Array.isArray(rows)) return rows as never
      return (await Promise.all(rows.map((row) => decryptRow(row)))) as never
    },
    consumeOne: async (input) => {
      const row = await adapter.consumeOne(input)
      return (input.model === SSO_PROVIDER_MODEL ? await decryptRow(row) : row) as never
    },
    incrementOne: async (input) => {
      const row = await adapter.incrementOne(input)
      return (input.model === SSO_PROVIDER_MODEL ? await decryptRow(row) : row) as never
    },
  }
}

/**
 * Rewrites only the secret columns a write actually carries. A payload that
 * omits them — the plugin marking a domain verified, say — is left untouched.
 */
async function encryptColumns(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  let next: Record<string, unknown> | null = null
  for (const column of SECRET_COLUMNS) {
    const value = payload[column]
    if (typeof value !== 'string') continue
    const encrypted = await encryptProviderConfig(value, column)
    if (encrypted === value) continue
    next ??= { ...payload }
    next[column] = encrypted
  }
  return next ?? payload
}

/**
 * Decrypts the secret columns of a returned row. Rows are also returned by
 * `update`, `consumeOne` and `incrementOne`, and a `select` projection can omit
 * the columns entirely, so every shape has to be tolerated.
 */
async function decryptRow<TRow>(row: TRow): Promise<TRow> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const record = row as Record<string, unknown>
  let next: Record<string, unknown> | null = null
  for (const column of SECRET_COLUMNS) {
    const value = record[column]
    if (typeof value !== 'string') continue
    const decrypted = await decryptProviderConfig(value, column)
    if (decrypted === value) continue
    next ??= { ...record }
    next[column] = decrypted
  }
  return (next ?? row) as TRow
}
