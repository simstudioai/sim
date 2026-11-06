import type { ToolConfig } from '@/tools/types'

export const gaugeAuthParams = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Gauge organization API key resolved from the selected credential',
  },
} as const satisfies ToolConfig['params']

export const gaugeOAuth = {
  required: true,
  provider: 'gauge',
  credentialKind: 'service-account',
} as const

/** Builds a provider URL while retaining repeated query keys for array filters. */
export function buildGaugeUrl(
  path: string,
  query: Record<string, string | number | boolean | readonly string[] | null | undefined> = {}
): string {
  const url = new URL(`https://app.withgauge.com/api/v1${path}`)
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, item)
    } else {
      url.searchParams.set(name, String(value))
    }
  }
  return url.toString()
}

/** Gauge accepts JSON request bodies and organization API keys as bearer tokens. */
export function gaugeHeaders(accessToken: string, hasBody = false): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  }
}

/** Parses block JSON inputs without conflating an explicit null with an omitted value. */
export function parseGaugeJson(value: unknown, name: string): unknown {
  if (typeof value !== 'string') return value
  if (!value.trim()) return undefined
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
}

/** Validates nonblank string arrays without changing the supplied values. */
export function parseGaugeStringArray(
  value: unknown,
  name: string,
  bounds: { min?: number; max?: number } = {}
): string[] {
  const parsed = parseGaugeJson(value, name)
  if (parsed == null && !bounds.min) return []
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${name} must be a JSON array of non-empty strings`)
  }
  if (
    (bounds.min !== undefined && parsed.length < bounds.min) ||
    (bounds.max !== undefined && parsed.length > bounds.max)
  ) {
    throw new Error(`${name} must contain ${bounds.min ?? 0} to ${bounds.max ?? 'unlimited'} items`)
  }
  return parsed
}
