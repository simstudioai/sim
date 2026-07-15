/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getEntityGroupsForLanguage,
  NER_PII_ENTITIES,
  normalizeRuleStages,
  stripNerEntities,
} from '@/lib/guardrails/pii-entities'

describe('NER_PII_ENTITIES', () => {
  it('covers the spaCy-NER entities including ORGANIZATION', () => {
    expect(new Set(NER_PII_ENTITIES)).toEqual(
      new Set(['PERSON', 'LOCATION', 'NRP', 'DATE_TIME', 'ORGANIZATION'])
    )
  })
})

describe('stripNerEntities', () => {
  it('drops NER entities and keeps regex/checksum ones (order preserved)', () => {
    expect(
      stripNerEntities([
        'PERSON',
        'EMAIL_ADDRESS',
        'DATE_TIME',
        'US_SSN',
        'ORGANIZATION',
        'LOCATION',
        'PHONE_NUMBER',
      ])
    ).toEqual(['EMAIL_ADDRESS', 'US_SSN', 'PHONE_NUMBER'])
  })

  it('returns an empty list when only NER was selected', () => {
    expect(stripNerEntities(['PERSON', 'NRP'])).toEqual([])
  })

  it('is a no-op for a regex-only list', () => {
    expect(stripNerEntities(['EMAIL_ADDRESS', 'US_SSN'])).toEqual(['EMAIL_ADDRESS', 'US_SSN'])
  })
})

describe('getEntityGroupsForLanguage', () => {
  const flatten = (groups: Array<{ entities: Array<{ value: string }> }>) =>
    groups.flatMap((g) => g.entities.map((e) => e.value))

  it('includes NER entities by default', () => {
    const values = flatten(getEntityGroupsForLanguage('en'))
    expect(values).toContain('PERSON')
    expect(values).toContain('EMAIL_ADDRESS')
  })

  it('excludes the spaCy-NER entities when regexOnly', () => {
    const values = flatten(getEntityGroupsForLanguage('en', { regexOnly: true }))
    for (const ner of ['PERSON', 'LOCATION', 'NRP', 'DATE_TIME']) {
      expect(values).not.toContain(ner)
    }
    // Regex/checksum entities remain selectable.
    expect(values).toContain('EMAIL_ADDRESS')
    expect(values).toContain('US_SSN')
  })
})

describe('normalizeRuleStages', () => {
  it('strips NER from a stored blockOutputs stage (input/logs keep it)', () => {
    const stages = normalizeRuleStages({
      stages: {
        input: { enabled: true, entityTypes: ['PERSON', 'EMAIL_ADDRESS'], language: 'en' },
        blockOutputs: { enabled: true, entityTypes: ['PERSON', 'EMAIL_ADDRESS'], language: 'en' },
        logs: { enabled: true, entityTypes: ['DATE_TIME'], language: 'en' },
      },
    })
    expect(stages.blockOutputs.entityTypes).toEqual(['EMAIL_ADDRESS'])
    expect(stages.blockOutputs.enabled).toBe(true)
    expect(stages.input.entityTypes).toEqual(['PERSON', 'EMAIL_ADDRESS'])
    expect(stages.logs.entityTypes).toEqual(['DATE_TIME'])
  })

  it('disables blockOutputs when the NER strip empties it', () => {
    const stages = normalizeRuleStages({
      stages: {
        input: { enabled: false, entityTypes: [] },
        blockOutputs: { enabled: true, entityTypes: ['PERSON', 'LOCATION'] },
        logs: { enabled: false, entityTypes: [] },
      },
    })
    expect(stages.blockOutputs.entityTypes).toEqual([])
    expect(stages.blockOutputs.enabled).toBe(false)
  })
})
