import { sha256Hex } from '@sim/security/hash'
import { env, envNumber } from '@/lib/core/config/env'
import type { ProviderCapacityConfig } from '@/lib/core/rate-limiter/provider-capacity-state'
import { MISTRAL_OCR_REQUEST_POLICY } from '@/lib/knowledge/documents/ocr-request-policy'

/** Configured ceilings are operating budgets; adaptive feedback may lower effective throughput. */
export function getMistralCapacityConfig(): ProviderCapacityConfig {
  const pagesPerMinute = envNumber(env.KB_CONFIG_MISTRAL_OCR_PAGES_PER_MINUTE, 1000, {
    min: 1,
    integer: true,
  })
  return {
    requestsPerMinute: envNumber(env.KB_CONFIG_OCR_REQUESTS_PER_MINUTE, 60, { min: 1 }),
    pagesPerMinute,
    initialPageTokens: Math.min(getMistralOcrPagesPerRequest(), pagesPerMinute),
    maxConcurrent: Math.min(
      64,
      envNumber(env.KB_CONFIG_MISTRAL_OCR_MAX_CONCURRENT, 2, { min: 1, integer: true })
    ),
    minimumScale: 0.1,
    recoveryIntervalMs: 60_000,
  }
}

/** Small page ranges bound request latency, memory and repeated work after a provider failure. */
export function getMistralOcrPagesPerRequest(): number {
  return Math.min(
    MISTRAL_OCR_REQUEST_POLICY.maxPages,
    envNumber(env.KB_CONFIG_MISTRAL_OCR_PAGES_PER_REQUEST, 30, { min: 1, integer: true }),
    envNumber(env.KB_CONFIG_MISTRAL_OCR_PAGES_PER_MINUTE, 1000, { min: 1, integer: true })
  )
}

/**
 * Hosted credentials share a stable deployment scope across rotation. Explicit fingerprint
 * mappings also coordinate BYOK credentials belonging to the same Mistral organization.
 * Unmapped BYOK credentials remain isolated; raw keys never enter storage or telemetry.
 */
export function getMistralCapacityScope(apiKey: string): string {
  const fingerprint = sha256Hex(apiKey)
  const groupsJson = env.MISTRAL_OCR_QUOTA_GROUPS
  if (groupsJson) {
    let groups: unknown
    try {
      if (groupsJson.length > 32_768) throw new Error('Oversized quota configuration')
      groups = JSON.parse(groupsJson)
    } catch {
      throw new Error(
        'MISTRAL_OCR_QUOTA_GROUPS must be a JSON map of key fingerprints to organizations'
      )
    }
    if (
      typeof groups !== 'object' ||
      groups === null ||
      Array.isArray(groups) ||
      Object.keys(groups).length > 128 ||
      Object.entries(groups).some(
        ([key, group]) =>
          !/^[a-f0-9]{64}$/.test(key) ||
          typeof group !== 'string' ||
          group.length < 1 ||
          group.length > 128
      )
    )
      throw new Error('Invalid MISTRAL_OCR_QUOTA_GROUPS configuration')
    if (Object.hasOwn(groups, fingerprint)) {
      const group = (groups as Record<string, string>)[fingerprint]
      return sha256Hex(`organization:${group}`)
    }
  }
  return sha256Hex(
    apiKey === env.MISTRAL_API_KEY ? 'hosted-mistral-organization' : `key:${fingerprint}`
  )
}
