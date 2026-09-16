/**
 * @vitest-environment node
 */
import { sha256Hex } from '@sim/security/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { settings } = vi.hoisted(() => ({ settings: {} as Record<string, string | undefined> }))
vi.mock('@/lib/core/config/env', () => ({
  env: settings,
  envNumber: (
    value: unknown,
    fallback: number,
    options: { min?: number; integer?: boolean } = {}
  ) => {
    const number = value === undefined ? Number.NaN : Number(value)
    return Number.isFinite(number) &&
      number >= (options.min ?? 0) &&
      (!options.integer || Number.isInteger(number))
      ? number
      : fallback
  },
}))

import {
  getMistralCapacityConfig,
  getMistralCapacityScope,
  getMistralOcrPagesPerRequest,
} from '@/lib/internal/mistral/capacity'

describe('Mistral operating configuration', () => {
  beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key]
  })

  it('defaults to small requests with shared page, request and in-flight budgets', () => {
    expect(getMistralOcrPagesPerRequest()).toBe(30)
    expect(getMistralCapacityConfig()).toMatchObject({
      requestsPerMinute: 60,
      pagesPerMinute: 1000,
      initialPageTokens: 30,
      maxConcurrent: 2,
    })
  })

  it('honors deployment settings and keeps requests within the page budget', () => {
    settings.KB_CONFIG_MISTRAL_OCR_PAGES_PER_MINUTE = '10'
    settings.KB_CONFIG_MISTRAL_OCR_PAGES_PER_REQUEST = '40'
    settings.KB_CONFIG_MISTRAL_OCR_MAX_CONCURRENT = '4'
    settings.KB_CONFIG_OCR_REQUESTS_PER_MINUTE = '12'
    expect(getMistralOcrPagesPerRequest()).toBe(10)
    expect(getMistralCapacityConfig()).toMatchObject({
      requestsPerMinute: 12,
      pagesPerMinute: 10,
      initialPageTokens: 10,
      maxConcurrent: 4,
    })
  })

  it('retains hard limits and bounded state for oversized settings', () => {
    settings.KB_CONFIG_MISTRAL_OCR_PAGES_PER_MINUTE = '1000000'
    settings.KB_CONFIG_MISTRAL_OCR_PAGES_PER_REQUEST = '1000000'
    settings.KB_CONFIG_MISTRAL_OCR_MAX_CONCURRENT = '1000000'
    expect(getMistralOcrPagesPerRequest()).toBe(1000)
    expect(getMistralCapacityConfig().maxConcurrent).toBe(64)
  })

  it('keeps the hosted organization scope stable across key rotation', () => {
    settings.MISTRAL_API_KEY = 'original-hosted-key'
    const original = getMistralCapacityScope('original-hosted-key')
    settings.MISTRAL_API_KEY = 'rotated-hosted-key'
    expect(getMistralCapacityScope('rotated-hosted-key')).toBe(original)
    expect(getMistralCapacityScope('byok')).not.toBe(original)
  })

  it('groups keys in one organization without storing raw credentials', () => {
    settings.MISTRAL_OCR_QUOTA_GROUPS = JSON.stringify({
      [sha256Hex('byok-one')]: 'org-a',
      [sha256Hex('byok-two')]: 'org-a',
      [sha256Hex('byok-three')]: 'org-b',
    })
    expect(getMistralCapacityScope('byok-one')).toBe(getMistralCapacityScope('byok-two'))
    expect(getMistralCapacityScope('byok-one')).not.toBe(getMistralCapacityScope('byok-three'))
    expect(getMistralCapacityScope('byok-one')).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    'no-json',
    '[]',
    'null',
    '{"raw-api-key":"org"}',
    JSON.stringify({ [sha256Hex('key')]: {} }),
  ])('fails closed for invalid group configuration %s', (value) => {
    settings.MISTRAL_OCR_QUOTA_GROUPS = value
    expect(() => getMistralCapacityScope('key')).toThrow(/QUOTA_GROUPS/)
  })
})
