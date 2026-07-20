import { sha256Hex } from '@sim/security/hash'
import { isPlainRecord } from '@sim/utils/object'

export interface DesiredWebhookRegistrationIdentity {
  provider: string
  path: string | null
  routingKey: string | null
  /**
   * The user-controlled projection produced while building the desired trigger configuration.
   * Provider-managed subscription metadata and polling cursors must not be included.
   */
  desiredConfig: Readonly<Record<string, unknown>>
}

type CanonicalValue =
  | ['array', CanonicalValue[]]
  | ['bigint', string]
  | ['boolean', boolean]
  | ['null']
  | ['number', string]
  | ['object', Array<[string, CanonicalValue]>]
  | ['string', string]
  | ['undefined']

/** Normalizes a webhook path for desired-registration identity comparisons. */
export function normalizeWebhookRegistrationPath(path: string | null): string | null {
  if (path === null) return null
  return path.trim().replace(/^\/+|\/+$/g, '')
}

function canonicalizeNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Number.POSITIVE_INFINITY) return 'Infinity'
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity'
  if (Object.is(value, -0)) return '-0'
  return String(value)
}

function canonicalize(value: unknown, ancestors: Set<object>): CanonicalValue {
  if (value === null) return ['null']
  if (value === undefined) return ['undefined']
  if (typeof value === 'boolean') return ['boolean', value]
  if (typeof value === 'number') return ['number', canonicalizeNumber(value)]
  if (typeof value === 'string') return ['string', value]
  if (typeof value === 'bigint') return ['bigint', value.toString()]

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError('Desired webhook registration config cannot contain cycles')
    }
    ancestors.add(value)
    try {
      return ['array', value.map((entry) => canonicalize(entry, ancestors))]
    } finally {
      ancestors.delete(value)
    }
  }

  if (isPlainRecord(value)) {
    if (ancestors.has(value)) {
      throw new TypeError('Desired webhook registration config cannot contain cycles')
    }
    ancestors.add(value)
    try {
      const entries = Object.keys(value)
        .sort()
        .map<[string, CanonicalValue]>((key) => [key, canonicalize(value[key], ancestors)])
      return ['object', entries]
    } finally {
      ancestors.delete(value)
    }
  }

  throw new TypeError(
    `Unsupported desired webhook registration config value: ${Object.prototype.toString.call(value)}`
  )
}

/**
 * Returns a deterministic fingerprint for a desired webhook registration.
 *
 * The caller must pass the explicit user-controlled config projection built from the trigger,
 * never a persisted providerConfig row that may contain mutable provider or polling state.
 */
export function fingerprintDesiredWebhookRegistration(
  identity: DesiredWebhookRegistrationIdentity
): string {
  const canonicalIdentity = canonicalize(
    {
      provider: identity.provider,
      path: normalizeWebhookRegistrationPath(identity.path),
      routingKey: identity.routingKey,
      desiredConfig: identity.desiredConfig,
    },
    new Set()
  )

  return sha256Hex(JSON.stringify(canonicalIdentity))
}
