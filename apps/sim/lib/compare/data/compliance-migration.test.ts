/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { simProfile } from '@/lib/compare/data'
import type { CompetitorProfile } from '@/lib/compare/data/types'
import { COMPARISON_SECTIONS } from '@/app/(landing)/comparisons/comparison-sections'
import { ALL_COMPETITORS } from '@/app/(landing)/comparisons/utils'

const PROFILES = [...ALL_COMPETITORS, simProfile] satisfies CompetitorProfile[]

const EXPECTED_PROFILE_IDS = [
  'claude-cowork',
  'crewai',
  'dust',
  'flowise',
  'gumloop',
  'langchain',
  'langflow',
  'make',
  'microsoft-copilot',
  'n8n',
  'openai-agentkit',
  'openclaw',
  'pipedream',
  'power-automate',
  'retool',
  'sim',
  'stack-ai',
  'tines',
  'vellum',
  'workato',
  'zapier',
] as const

function collectKeyPaths(value: unknown, targetKeys: ReadonlySet<string>, path = ''): string[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key
    const matchingPath = targetKeys.has(key) ? [childPath] : []
    return [...matchingPath, ...collectKeyPaths(child, targetKeys, childPath)]
  })
}

describe('comparison compliance data migration', () => {
  it('defines Compliance as the only compliance row and places it first in Security', () => {
    const securitySection = COMPARISON_SECTIONS.find(({ group }) => group === 'security')
    const complianceRows = COMPARISON_SECTIONS.flatMap(({ rows }) => rows).filter(
      ({ key }) => key === 'compliance'
    )
    const legacyRows = COMPARISON_SECTIONS.flatMap(({ rows }) => rows).filter(({ key }) =>
      ['soc2', 'additionalCompliance'].includes(key)
    )

    expect(securitySection?.rows[0]).toEqual({ key: 'compliance', label: 'Compliance' })
    expect(complianceRows).toEqual([{ key: 'compliance', label: 'Compliance' }])
    expect(legacyRows).toEqual([])
  })

  it('covers the canonical competitor set and Sim exactly once', () => {
    const ids = PROFILES.map(({ id }) => id)

    expect(ids).toHaveLength(EXPECTED_PROFILE_IDS.length)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.toSorted()).toEqual([...EXPECTED_PROFILE_IDS].toSorted())
  })

  it.each(PROFILES)('$name has one canonical compliance fact and no legacy fields', (profile) => {
    expect(collectKeyPaths(profile, new Set(['compliance']))).toEqual(['facts.security.compliance'])
    expect(collectKeyPaths(profile, new Set(['soc2', 'additionalCompliance']))).toEqual([])
  })

  it.each(PROFILES)('$name supplies the required shared Fact shape for compliance', (profile) => {
    const fact = profile.facts.security.compliance

    expect(fact.value).toEqual(expect.any(String))
    expect(fact.value.length).toBeGreaterThan(0)
    expect(['verified', 'estimated', 'unknown']).toContain(fact.confidence)
    expect(Array.isArray(fact.sources)).toBe(true)

    for (const source of fact.sources) {
      expect(source).toEqual({
        url: expect.any(String),
        label: expect.any(String),
        asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    }
  })

  it.each(PROFILES)('$name supplies a concise compliance summary', (profile) => {
    const shortValue = profile.facts.security.compliance.shortValue

    expect(shortValue).toEqual(expect.any(String))
    expect(shortValue?.trim().split(/\s+/).length ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      10
    )
  })

  it.each(PROFILES)('$name backs non-unknown compliance statements with citations', (profile) => {
    const fact = profile.facts.security.compliance
    if (fact.confidence !== 'unknown') {
      expect(fact.sources.length).toBeGreaterThan(0)
    }
    for (const source of fact.sources) {
      expect(new URL(source.url).protocol).toBe('https:')
      expect(source.label.trim().length).toBeGreaterThan(0)
    }
  })
})
