import { describe, expect, it } from 'vitest'
import {
  getEntityGroupsForLanguage,
  normalizeRuleStages,
  sanitizeCustomPatterns,
  stripNerEntities,
} from '@/lib/guardrails/pii-entities'

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
})

describe('getEntityGroupsForLanguage', () => {
  const flatten = (groups: Array<{ entities: Array<{ value: string }> }>) =>
    groups.flatMap((g) => g.entities.map((e) => e.value))

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

  it('sanitizes stored custom patterns on every stage', () => {
    const stages = normalizeRuleStages({
      stages: {
        input: {
          enabled: true,
          entityTypes: [],
          customPatterns: [
            { name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' },
            // Malformed rows are dropped.
            { name: 'no regex', regex: '', replacement: 'x' } as never,
          ],
        },
        blockOutputs: { enabled: false, entityTypes: [] },
        logs: { enabled: false, entityTypes: [] },
      },
    })
    expect(stages.input.customPatterns).toEqual([
      { name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' },
    ])
    expect(stages.input.enabled).toBe(true)
  })
})

describe('sanitizeCustomPatterns', () => {
  it('drops non-arrays and malformed rows, coercing missing fields', () => {
    expect(sanitizeCustomPatterns(undefined)).toEqual([])
    expect(sanitizeCustomPatterns('nope')).toEqual([])
    expect(
      sanitizeCustomPatterns([
        { name: 'A', regex: 'a+', replacement: '<A>' },
        { regex: 'b+' },
        { name: 'no regex', regex: '', replacement: 'x' },
        null,
        { name: 'bad', regex: 42 },
      ])
    ).toEqual([
      { name: 'A', regex: 'a+', replacement: '<A>' },
      { name: '', regex: 'b+', replacement: '' },
    ])
  })
})
