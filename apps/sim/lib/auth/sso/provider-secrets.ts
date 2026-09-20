import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

const logger = createLogger('SsoProviderSecrets')

/**
 * The secret-bearing fields inside each provider config column. Everything else
 * an IdP config carries — endpoints, scopes, the SAML certificate, attribute
 * mapping — is public configuration and stays readable, so the column remains
 * ordinary JSON for the readers that only need those.
 */
const SECRET_FIELDS = {
  oidcConfig: ['clientSecret'],
  samlConfig: ['privateKey', 'decryptionPvk'],
} as const

export type SsoConfigColumn = keyof typeof SECRET_FIELDS

/**
 * The shape {@link encryptSecret} produces: a 16-byte IV and a 16-byte GCM auth
 * tag around hex ciphertext. Matching it exactly is what lets a value written
 * before these fields were encrypted be recognized as legacy plain text and
 * returned unchanged — the same tolerance `decryptApiKey` gives API keys.
 */
const ENVELOPE = /^[0-9a-f]{32}:[0-9a-f]+:[0-9a-f]{32}$/

function isEnvelope(value: string): boolean {
  return ENVELOPE.test(value)
}

function parseConfig(config: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(config)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Maps the secret fields of one provider config through `transform`, leaving the
 * rest of the JSON byte-identical in field order. A column that is null, not an
 * object, or not JSON at all is returned unchanged: this runs on every read of
 * every provider row, and a config Sim does not recognize is the storage
 * layer's to pass through, not to reject.
 */
async function mapSecretFields(
  config: string | null | undefined,
  column: SsoConfigColumn,
  transform: (value: string) => Promise<string>
): Promise<string | null | undefined> {
  if (!config) return config
  const parsed = parseConfig(config)
  if (!parsed) return config

  let changed = false
  for (const field of SECRET_FIELDS[column]) {
    const value = parsed[field]
    if (typeof value !== 'string' || value === '') continue
    const next = await transform(value)
    if (next === value) continue
    parsed[field] = next
    changed = true
  }

  return changed ? JSON.stringify(parsed) : config
}

/**
 * Encrypts the secret fields of a provider config for storage. Already-encrypted
 * values are left alone, so a config that Better Auth merged from a stored row
 * (`mergeOIDCConfig` carries the existing `clientSecret` forward when an update
 * omits it) is never wrapped twice.
 */
export function encryptProviderConfig(
  config: string | null | undefined,
  column: SsoConfigColumn
): Promise<string | null | undefined> {
  return mapSecretFields(config, column, async (value) =>
    isEnvelope(value) ? value : (await encryptSecret(value)).encrypted
  )
}

/**
 * Decrypts the secret fields of a stored provider config. Values written before
 * these fields were encrypted lack the envelope shape and are returned as-is.
 *
 * A value that IS an envelope but fails to decrypt — a wrong or rotated
 * `ENCRYPTION_KEY`, a tampered row — throws rather than degrading to ciphertext.
 * Handing ciphertext to an IdP as a client secret would fail the token exchange
 * with an opaque `invalid_client`; failing here names the real cause.
 */
export function decryptProviderConfig(
  config: string | null | undefined,
  column: SsoConfigColumn
): Promise<string | null | undefined> {
  return mapSecretFields(config, column, async (value) => {
    if (!isEnvelope(value)) return value
    try {
      return (await decryptSecret(value, { logFailure: false })).decrypted
    } catch (error) {
      logger.error('Failed to decrypt an SSO provider secret', {
        column,
        error: toError(error).message,
      })
      throw new Error(
        `Could not decrypt the stored ${column} secret. It was encrypted with a different ENCRYPTION_KEY.`
      )
    }
  })
}
