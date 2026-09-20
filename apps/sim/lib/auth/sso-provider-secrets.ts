import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

const logger = createLogger('SsoProviderSecrets')

/**
 * Paths to the secret-bearing fields inside each provider config column, as
 * property chains. Everything else an IdP config carries — endpoints, scopes,
 * the SAML certificate, attribute mapping — is public configuration and stays
 * readable, so the column remains ordinary JSON for the readers that only need
 * those.
 *
 * The service-provider keys are nested: Better Auth's SAML support signs
 * requests with `spMetadata.privateKey` and decrypts assertions with
 * `spMetadata.encPrivateKey`. The two flat names are the shapes the operator
 * registration script writes, kept so rows it created are covered too.
 */
export const SECRET_FIELDS = {
  oidcConfig: [['clientSecret']],
  samlConfig: [
    ['privateKey'],
    ['decryptionPvk'],
    ['spMetadata', 'privateKey'],
    ['spMetadata', 'encPrivateKey'],
  ],
} as const satisfies Record<string, readonly (readonly string[])[]>

export type SsoConfigColumn = keyof typeof SECRET_FIELDS

/**
 * Marks a value this module encrypted. An explicit prefix, rather than matching
 * the `iv:ciphertext:authTag` shape, is what makes the distinction unambiguous:
 * a client secret is an arbitrary string chosen at the identity provider, and
 * one that happened to look like an envelope would otherwise be read back as
 * ciphertext and fail to decrypt. Values without the prefix were stored before
 * these fields were encrypted and are passed through unchanged, the tolerance
 * `decryptApiKey` gives API keys.
 *
 * The version lets a future encoding change be told apart from this one.
 */
const ENVELOPE_PREFIX = 'sim.sso.v1:'

function isEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX)
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
  for (const path of SECRET_FIELDS[column]) {
    const holder = resolveHolder(parsed, path)
    if (!holder) continue
    const field = path[path.length - 1]
    const value = holder[field]
    if (typeof value !== 'string' || value === '') continue
    const next = await transform(value)
    if (next === value) continue
    holder[field] = next
    changed = true
  }

  return changed ? JSON.stringify(parsed) : config
}

/** The object holding the last segment of `path`, or null when the chain is absent. */
export function resolveHolder(
  parsed: Record<string, unknown>,
  path: readonly string[]
): Record<string, unknown> | null {
  let holder: Record<string, unknown> = parsed
  for (const segment of path.slice(0, -1)) {
    const next = holder[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) return null
    holder = next as Record<string, unknown>
  }
  return holder
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
    isEnvelope(value) ? value : `${ENVELOPE_PREFIX}${(await encryptSecret(value)).encrypted}`
  )
}

/**
 * Decrypts the secret fields of a stored provider config. Values written before
 * these fields were encrypted lack the prefix and are returned as-is.
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
      return (await decryptSecret(value.slice(ENVELOPE_PREFIX.length), { logFailure: false }))
        .decrypted
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
