import { hostedKeyMetrics } from '@/lib/monitoring/metrics'
import type { ToolHostingPricing } from '@/tools/types'

export interface HostedCostResult {
  /** Total billable cost in dollars. */
  cost: number
  /** Optional metadata about the cost (e.g. provider breakdown from `custom` pricing). */
  metadata?: Record<string, unknown>
}

/**
 * Cost for a hosted-key **tool** call. Tools declare config-driven pricing —
 * a flat `per_request` fee or a response-derived `custom` fee. LLM providers do
 * NOT use this: their cost is token-based and computed directly via
 * {@link import('@/providers/utils').calculateCost}.
 */
export function calculateHostedCost(
  pricing: ToolHostingPricing,
  params: Record<string, unknown>,
  response: Record<string, unknown>
): HostedCostResult {
  switch (pricing.type) {
    case 'per_request':
      return { cost: pricing.cost }

    case 'custom': {
      const result = pricing.getCost(params, response)
      return typeof result === 'number' ? { cost: result } : result
    }

    default: {
      const exhaustiveCheck: never = pricing
      throw new Error(`Unknown pricing type: ${(exhaustiveCheck as ToolHostingPricing).type}`)
    }
  }
}

/**
 * Classify a thrown error into a hosted-key failure reason for metrics. Handles
 * both structured SDK errors (numeric `.status`) and provider errors that embed
 * the status in the message string (e.g. `API error (401): ...`). Some providers
 * signal quota/rate-limit via 401/403 + a descriptive message, so those count as
 * `rate_limited`, not `auth`.
 */
export function classifyHostedKeyFailure(error: unknown): 'rate_limited' | 'auth' | 'other' {
  const status = (error as { status?: number } | null)?.status
  const message = ((error as { message?: string } | null)?.message ?? '').toLowerCase()

  if (status === 429 || status === 503) return 'rate_limited'
  if (status === 401 || status === 403) {
    return message.includes('quota') || message.includes('rate limit') ? 'rate_limited' : 'auth'
  }

  // No structured status (e.g. provider errors that embed it in the message).
  if (status === undefined) {
    if (
      message.includes('quota') ||
      message.includes('rate limit') ||
      /\b(429|503)\b/.test(message)
    )
      return 'rate_limited'
    if (
      /\b(401|403)\b/.test(message) ||
      message.includes('unauthor') ||
      message.includes('forbidden') ||
      message.includes('invalid api key')
    )
      return 'auth'
  }
  return 'other'
}

/**
 * Emit hosted-key usage telemetry for a completed call. CloudWatch only — never
 * a billing write. `recordCostCharged` self-guards on `costTotal > 0`. The
 * `tool` label carries the tool id for tools, or the model id for LLM calls.
 */
export function emitHostedKeyUsage(labels: {
  provider: string
  tool: string
  key: string
  costTotal: number
}): void {
  hostedKeyMetrics.recordUsed({
    provider: labels.provider,
    tool: labels.tool,
    key: labels.key,
  })
  hostedKeyMetrics.recordCostCharged(labels.costTotal, {
    provider: labels.provider,
    tool: labels.tool,
  })
}
