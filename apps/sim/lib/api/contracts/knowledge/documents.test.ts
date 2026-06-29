/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  listKnowledgeDocumentsQuerySchema,
  parseDocumentTagFiltersParam,
} from '@/lib/api/contracts/knowledge/documents'

describe('listKnowledgeDocumentsQuerySchema.tagFilters', () => {
  it('keeps tagFilters a raw string (must NOT transform to an array)', () => {
    // A transform-to-array here breaks requestJson outbound serialization
    // (the array serializes as "[object Object]"). The wire type must stay a
    // string; decoding happens server-side via parseDocumentTagFiltersParam.
    const tagFilters = JSON.stringify([
      { tagSlot: 'tag1', fieldType: 'text', operator: 'contains', value: 'x' },
    ])
    const parsed = listKnowledgeDocumentsQuerySchema.parse({ tagFilters })
    expect(parsed.tagFilters).toBe(tagFilters)
    expect(typeof parsed.tagFilters).toBe('string')
  })
})

describe('parseDocumentTagFiltersParam', () => {
  it('returns undefined for an absent param', () => {
    expect(parseDocumentTagFiltersParam(undefined)).toBeUndefined()
    expect(parseDocumentTagFiltersParam('')).toBeUndefined()
  })

  it('decodes a valid JSON array of filters', () => {
    const filters = [
      { tagSlot: 'tag1', fieldType: 'text', operator: 'contains', value: 'x' },
      { tagSlot: 'date1', fieldType: 'date', operator: 'eq', value: '2026-04-21' },
    ]
    expect(parseDocumentTagFiltersParam(JSON.stringify(filters))).toEqual(filters)
  })

  it('throws on malformed JSON', () => {
    expect(() => parseDocumentTagFiltersParam('[object Object]')).toThrow()
    expect(() => parseDocumentTagFiltersParam('{not json')).toThrow()
  })

  it('throws when the shape is wrong', () => {
    expect(() => parseDocumentTagFiltersParam(JSON.stringify([{ tagSlot: '' }]))).toThrow()
  })

  it('rejects an operator that is not valid for the field type', () => {
    // unknown operator
    expect(() =>
      parseDocumentTagFiltersParam(
        JSON.stringify([{ tagSlot: 'tag1', fieldType: 'text', operator: 'bogus', value: 'x' }])
      )
    ).toThrow()
    // valid operator name, wrong field type (contains is text-only)
    expect(() =>
      parseDocumentTagFiltersParam(
        JSON.stringify([
          { tagSlot: 'number1', fieldType: 'number', operator: 'contains', value: '1' },
        ])
      )
    ).toThrow()
  })

  it('rejects a fieldType that does not match the tag slot', () => {
    // number1 is a numeric column; claiming it is text must fail
    expect(() =>
      parseDocumentTagFiltersParam(
        JSON.stringify([
          { tagSlot: 'number1', fieldType: 'text', operator: 'contains', value: 'x' },
        ])
      )
    ).toThrow()
  })

  it('rejects an unknown tag slot', () => {
    expect(() =>
      parseDocumentTagFiltersParam(
        JSON.stringify([{ tagSlot: 'tag99', fieldType: 'text', operator: 'eq', value: 'x' }])
      )
    ).toThrow()
  })
})
