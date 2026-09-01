import type { ManagedApiKeyEnvelope } from '@sim/db/schema'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import type { CredentialGroupApiKeyField } from '@/lib/credential-groups/providers'

const MANAGED_API_KEY_ENVELOPE_TYPE = 'managed-api-key' as const
const MANAGED_API_KEY_ENVELOPE_VERSION = 1 as const

/**
 * Shortest secret value we will store.
 *
 * `MIN_SUBSTITUTABLE_LITERAL_LENGTH` in the resolved-secret match policy is the length below
 * which a literal is deliberately never redacted, because a match on it is not evidence the
 * secret is present. A shorter value would therefore be stored as something we cannot keep out
 * of logs or model-visible content, so it is refused at collection instead.
 *
 * Applies only to fields declared `secret`. A non-secret field (a subdomain, a region) is never
 * catalogued for redaction, so the floor is meaningless for it and would just reject valid input.
 */
export const MIN_MANAGED_API_KEY_LENGTH = 8

/** Longest value we will store, well past any real credential, to bound the ciphertext. */
export const MAX_MANAGED_API_KEY_LENGTH = 4096

/** Shortest non-secret value, which only has to be non-empty. */
const MIN_MANAGED_API_KEY_NON_SECRET_LENGTH = 1

export class ManagedApiKeyFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManagedApiKeyFormatError'
  }
}

function isManagedApiKeyEnvelope(value: unknown): value is ManagedApiKeyEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ManagedApiKeyEnvelope>
  if (
    candidate.type !== MANAGED_API_KEY_ENVELOPE_TYPE ||
    candidate.version !== MANAGED_API_KEY_ENVELOPE_VERSION ||
    typeof candidate.fields !== 'object' ||
    candidate.fields === null
  ) {
    return false
  }
  const entries = Object.entries(candidate.fields)
  return entries.length > 0 && entries.every(([, value]) => typeof value === 'string' && value)
}

/**
 * Validates and trims every value an invited person supplied, against the fields the provider
 * declares. Unknown or missing fields are rejected rather than dropped, so a provider whose
 * field list changed cannot silently store a partial credential.
 */
export function requireStorableManagedApiKeyFields(
  fields: readonly CredentialGroupApiKeyField[],
  submitted: Record<string, string>
): Record<string, string> {
  const declared = new Set(fields.map((field) => field.id))
  for (const key of Object.keys(submitted)) {
    if (!declared.has(key)) {
      throw new ManagedApiKeyFormatError(`Unexpected field ${key}`)
    }
  }

  const result: Record<string, string> = {}
  for (const field of fields) {
    const raw = submitted[field.id]
    if (typeof raw !== 'string') {
      throw new ManagedApiKeyFormatError(`${field.label} is required`)
    }
    const trimmed = raw.trim()
    const minimum = field.secret
      ? MIN_MANAGED_API_KEY_LENGTH
      : MIN_MANAGED_API_KEY_NON_SECRET_LENGTH
    if (trimmed.length < minimum) {
      throw new ManagedApiKeyFormatError(
        field.secret
          ? `${field.label} must be at least ${MIN_MANAGED_API_KEY_LENGTH} characters`
          : `${field.label} is required`
      )
    }
    if (trimmed.length > MAX_MANAGED_API_KEY_LENGTH) {
      throw new ManagedApiKeyFormatError(
        `${field.label} must be at most ${MAX_MANAGED_API_KEY_LENGTH} characters`
      )
    }
    result[field.id] = trimmed
  }
  return result
}

/**
 * Encrypts verified credential fields for `credential.encryptedApiKey`.
 *
 * `encryptSecret`, never `encryptApiKey`: the resolved-secret trace registry decrypts with
 * `decryptSecret`, and `encryptApiKey` silently stores plaintext when `API_ENCRYPTION_KEY`
 * is unset.
 */
export async function sealManagedApiKey(fields: Record<string, string>): Promise<string> {
  if (Object.keys(fields).length === 0) {
    throw new ManagedApiKeyFormatError('Managed API key envelope requires at least one field')
  }
  const envelope: ManagedApiKeyEnvelope = {
    type: MANAGED_API_KEY_ENVELOPE_TYPE,
    version: MANAGED_API_KEY_ENVELOPE_VERSION,
    fields,
  }
  const { encrypted } = await encryptSecret(JSON.stringify(envelope))
  return encrypted
}

export interface ManagedApiKeyProvenanceEntry {
  /** Catalog name; scoped per field so two secrets on one credential stay distinguishable. */
  name: string
  encryptedValue: string
}

export interface OpenedManagedApiKey {
  fields: Record<string, string>
  /**
   * One entry per **secret** field, each the `encryptSecret` of that bare value.
   *
   * The trace registry catalogs whatever a ciphertext decrypts to and redacts exactly that
   * literal, so a credential with two secrets needs two entries — the envelope ciphertext
   * would catalog the JSON document and redact neither value.
   */
  provenanceEntries: ManagedApiKeyProvenanceEntry[]
}

/**
 * The only way to read a managed API key.
 *
 * Returns the plaintext fields together with the per-secret ciphertexts the trace registry must
 * adopt, so no caller has to know that the at-rest form and the catalog form differ.
 */
export async function openManagedApiKeySecret(
  row: { encryptedApiKey: string },
  declaredFields: readonly CredentialGroupApiKeyField[]
): Promise<OpenedManagedApiKey> {
  const { decrypted } = await decryptSecret(row.encryptedApiKey)
  let parsed: unknown
  try {
    parsed = JSON.parse(decrypted)
  } catch {
    throw new ManagedApiKeyFormatError('Managed API key envelope is not valid JSON')
  }
  if (!isManagedApiKeyEnvelope(parsed)) {
    throw new ManagedApiKeyFormatError('Invalid managed API key envelope')
  }

  const secretFieldIds = new Set(
    declaredFields.filter((field) => field.secret).map((field) => field.id)
  )
  const provenanceEntries: ManagedApiKeyProvenanceEntry[] = []
  for (const [fieldId, value] of Object.entries(parsed.fields)) {
    if (!secretFieldIds.has(fieldId)) continue
    const { encrypted } = await encryptSecret(value)
    provenanceEntries.push({ name: fieldId, encryptedValue: encrypted })
  }

  return { fields: parsed.fields, provenanceEntries }
}
