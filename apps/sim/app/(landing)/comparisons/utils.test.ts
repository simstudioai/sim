/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { simProfile } from '@/lib/compare/data'
import {
  buildComparisonFaqs,
  describeFact,
  getComparisonReviewDate,
  getLatestVerifiedDate,
  mergeSources,
} from '@/app/(landing)/comparisons/utils'

describe('buildComparisonFaqs answers', () => {
  it('keeps decimal prices and qualifications in pricing answers', () => {
    const profile = structuredClone(simProfile)
    profile.facts.pricing.pricingModel.value = 'US$21.25 per month. Annual commitment required.'
    const answer = buildComparisonFaqs(profile).find(({ question }) =>
      question.startsWith("How does Sim's pricing")
    )?.answer
    expect(answer).toContain('US$21.25 per month. Annual commitment required.')
  })

  it('keeps a negative capability statement negative in the FAQ', () => {
    const profile = structuredClone(simProfile)
    profile.facts.platform.selfHostOption.value = 'No: self-hosted deployment'
    profile.facts.platform.selfHostOption.detail = 'The service is vendor-operated.'
    const answer = buildComparisonFaqs(profile).find(({ question }) =>
      question.startsWith('Does Sim support self-hosting')
    )?.answer
    expect(answer).toContain('no: self-hosted deployment. The service is vendor-operated.')
  })
})

function datedProfile(date = '2026-09-04') {
  const profile = structuredClone(simProfile)
  const source = { url: 'https://example.com/docs', label: 'Documentation', asOf: date }
  for (const group of Object.values(profile.facts)) {
    for (const fact of Object.values(group)) {
      fact.sources = [{ ...source }]
    }
  }
  for (const item of [...profile.standoutFeatures, ...profile.limitations]) {
    item.source = { ...source }
  }
  return profile
}

describe('comparison review dates', () => {
  it('uses the oldest citation across both profiles for the full review date', () => {
    const sim = datedProfile()
    const competitor = datedProfile('2026-07-02')
    competitor.facts.security.additionalCompliance.sources[0].asOf = '2026-09-04'
    expect(getComparisonReviewDate([sim, competitor])?.toISOString()).toBe(
      '2026-07-02T00:00:00.000Z'
    )
    expect(getLatestVerifiedDate(competitor).toISOString()).toBe('2026-09-04T00:00:00.000Z')
  })

  it('includes both kinds of cards and excludes brand lookup dates', () => {
    const profile = datedProfile()
    profile.standoutFeatures[0].source.asOf = '2026-08-01'
    profile.limitations[0].source.asOf = '2026-07-01'
    profile.brand = { icon: () => null, colors: [], source: 'Brand lookup', asOf: '2020-01-01' }
    expect(getComparisonReviewDate([profile])?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    profile.limitations[0].source.asOf = '2026-09-05'
    expect(getLatestVerifiedDate(profile).toISOString()).toBe('2026-09-05T00:00:00.000Z')
  })

  it.each(['invalid', '2026-02-30', '2026-9-4'])('rejects invalid citation date %s', (date) => {
    const profile = datedProfile()
    profile.limitations[0].source.asOf = date
    expect(getComparisonReviewDate([profile])).toBeNull()
  })

  it('requires evidence for asserted facts while allowing explicit unknowns', () => {
    const profile = datedProfile()
    profile.facts.security.additionalCompliance.sources = []
    profile.facts.security.additionalCompliance.confidence = 'verified'
    expect(getComparisonReviewDate([profile])).toBeNull()
    profile.facts.security.additionalCompliance.confidence = 'unknown'
    expect(getComparisonReviewDate([profile])?.toISOString()).toBe('2026-09-04T00:00:00.000Z')
  })

  it('does not invent a current review date without evidence', () => {
    const profile = datedProfile()
    for (const group of Object.values(profile.facts)) {
      for (const fact of Object.values(group)) {
        fact.confidence = 'unknown'
        fact.sources = []
      }
    }
    profile.standoutFeatures = []
    profile.limitations = []
    expect(getComparisonReviewDate([profile])).toBeNull()
    expect(getComparisonReviewDate([])).toBeNull()
    expect(getLatestVerifiedDate(profile).getTime()).toBe(0)
  })
})

describe('standalone fact descriptions', () => {
  it('retains confidence and details when a fact becomes an FAQ answer', () => {
    expect(
      describeFact({
        value: 'Custom integrations',
        detail: 'Available on Enterprise.',
        confidence: 'estimated',
        sources: [],
      })
    ).toBe('Estimate: custom integrations. Available on Enterprise.')
  })
})

describe('merged citation dates', () => {
  it('retains the oldest claim check when a URL supports multiple facts', () => {
    const source = { url: 'https://example.com/docs', label: 'Documentation', asOf: '2026-09-13' }
    expect(mergeSources([source], [{ ...source, asOf: '2026-08-01' }])[0].asOf).toBe('2026-08-01')
    expect(mergeSources([{ ...source, asOf: '2026-08-01' }], [source])[0].asOf).toBe('2026-08-01')
  })
})
