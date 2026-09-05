import type { ToolConfig } from '@/tools/types'

export const oracleEpcmOAuth = {
  required: true,
  provider: 'oracle-epm-enterprise-profitability',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const

export const oracleEpcmAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle EPM service-account credential for an EPCM tenant',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Basic authentication token injected from the selected credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'REST base URL injected from the selected credential',
  },
} satisfies ToolConfig['params']

/** Parses resolved JSON only at execution time, with a bounded serialized input. */
export function parseOracleEpcmJson(value: unknown, label: string): unknown {
  if (typeof value !== 'string') {
    assertOracleEpcmJsonBudget(value, label)
    return value
  }
  if (value.length > 4 * 1024 * 1024) throw new Error(`${label} exceeds the 4 MB input limit`)
  try {
    const parsed: unknown = JSON.parse(value)
    assertOracleEpcmJsonBudget(parsed, label)
    return parsed
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

/** Bounds object inputs before schemas copy collections or the transport serializes them. */
export function assertOracleEpcmJsonBudget(value: unknown, label: string): void {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  let bytes = 0
  const encoder = new TextEncoder()
  while (pending.length) {
    const next = pending.pop()!
    if (++nodes > 200_000 || next.depth > 32) {
      throw new Error(`${label} exceeds the supported JSON complexity`)
    }
    if (typeof next.value === 'string') {
      if (next.value.length > 4 * 1024 * 1024) {
        throw new Error(`${label} exceeds the 4 MB input limit`)
      }
      bytes += encoder.encode(next.value).length + 2
    } else if (Array.isArray(next.value)) {
      if (next.value.length + pending.length + nodes > 200_000) {
        throw new Error(`${label} exceeds the supported JSON complexity`)
      }
      bytes += next.value.length * 2
      for (let index = 0; index < next.value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(next.value, index)
        if (descriptor?.get || descriptor?.set) throw new Error(`${label} must be plain JSON`)
        pending.push({ value: descriptor?.value, depth: next.depth + 1 })
      }
    } else if (next.value && typeof next.value === 'object') {
      // Enumerate incrementally: Object.entries would copy every property before admission.
      for (const key in next.value) {
        if (!Object.hasOwn(next.value, key)) continue
        if (pending.length + nodes >= 200_000) {
          throw new Error(`${label} exceeds the supported JSON complexity`)
        }
        if (key.length > 4 * 1024 * 1024) {
          throw new Error(`${label} exceeds the 4 MB input limit`)
        }
        bytes += encoder.encode(key).length + 4
        if (bytes > 4 * 1024 * 1024) throw new Error(`${label} exceeds the 4 MB input limit`)
        const descriptor = Object.getOwnPropertyDescriptor(next.value, key)
        if (descriptor?.get || descriptor?.set) throw new Error(`${label} must be plain JSON`)
        pending.push({ value: descriptor?.value, depth: next.depth + 1 })
      }
    } else {
      bytes += 8
    }
    if (bytes > 4 * 1024 * 1024) throw new Error(`${label} exceeds the 4 MB input limit`)
  }
}

/** Preserves omitted values and rejects ambiguous boolean coercion after resolution. */
export function parseOracleEpcmBoolean(value: unknown): unknown {
  if (value === '' || value === undefined || value === null) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}
