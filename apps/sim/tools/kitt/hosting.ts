import type { KittFindEmailParams, KittVerifyEmailParams } from '@/tools/kitt/types'
import type { ToolHostingConfig } from '@/tools/types'

export const KITT_API_KEY_PREFIX = 'KITT_API_KEY'

export const KITT_FIND_EMAIL_USD = 0.005
export const KITT_VERIFY_EMAIL_USD = 0.0015

const KITT_HOSTED_REQUESTS_PER_MINUTE = 5
const KITT_VERIFY_OUTCOMES = new Set(['valid', 'valid-risky', 'invalid', 'unknown'])

/**
 * Kitt's public Pay As You Go base rates are $0.005 per found email and
 * $0.0015 per verification. Finder requests with no verified result are not
 * charged, while verification outcomes including unknown/catchall are charged.
 * This hosted guide deliberately uses the base self-serve rate rather than the
 * free allowance or the volume discount that begins after one million monthly
 * units. Sources retrieved 2026-08-26:
 * https://trykitt.ai/pricing
 * https://help.trykitt.ai/en/articles/11739656-pricing-faqs
 *
 * Kitt documents a default limit of 15 concurrent requests per API key. Sim's
 * limiter is RPM-based, so five requests per minute caps one workspace's burst
 * at one third of that allocation and models a conservative worst case where a
 * real-time request occupies a slot for up to one minute. Source retrieved
 * 2026-08-26: https://help.trykitt.ai/en/articles/11185667-api-rate-limits
 */
const KITT_RATE_LIMIT = {
  mode: 'per_request',
  requestsPerMinute: KITT_HOSTED_REQUESTS_PER_MINUTE,
} as const

export const kittFindEmailHosting: ToolHostingConfig<KittFindEmailParams> = {
  envKeyPrefix: KITT_API_KEY_PREFIX,
  apiKeyParam: 'apiKey',
  byokProviderId: 'kitt',
  pricing: {
    type: 'custom',
    getCost: (_params, output) => {
      const outcome = output.outcome
      if (outcome === 'no-results-found') {
        return { cost: 0, metadata: { outcome, unitPriceUsd: KITT_FIND_EMAIL_USD } }
      }
      if (outcome !== 'success') {
        throw new Error('Kitt find email response is missing a recognized billing outcome')
      }
      if (typeof output.email !== 'string' || output.email.trim().length === 0) {
        throw new Error('Kitt find email response is missing the billed email result')
      }
      return {
        cost: KITT_FIND_EMAIL_USD,
        metadata: { outcome, unitPriceUsd: KITT_FIND_EMAIL_USD },
      }
    },
  },
  rateLimit: KITT_RATE_LIMIT,
}

export const kittVerifyEmailHosting: ToolHostingConfig<KittVerifyEmailParams> = {
  envKeyPrefix: KITT_API_KEY_PREFIX,
  apiKeyParam: 'apiKey',
  byokProviderId: 'kitt',
  pricing: {
    type: 'custom',
    getCost: (_params, output) => {
      const outcome = output.outcome
      if (typeof outcome !== 'string' || !KITT_VERIFY_OUTCOMES.has(outcome)) {
        throw new Error('Kitt verify email response is missing a recognized billing outcome')
      }
      return {
        cost: KITT_VERIFY_EMAIL_USD,
        metadata: { outcome, unitPriceUsd: KITT_VERIFY_EMAIL_USD },
      }
    },
  },
  rateLimit: KITT_RATE_LIMIT,
}
