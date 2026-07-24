/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildJiraCustomFields, serializeJiraCustomField } from '@/tools/jira/utils'

describe('serializeJiraCustomField', () => {
  it('serializes a select with a string value to { value }', () => {
    expect(serializeJiraCustomField({ fieldId: 'cf', type: 'select', value: 'High' })).toEqual({
      value: 'High',
    })
  })

  it('serializes a select with a numeric-looking value to { id }', () => {
    expect(serializeJiraCustomField({ fieldId: 'cf', type: 'select', value: '10023' })).toEqual({
      id: '10023',
    })
  })

  it('unwraps an option object when serializing a select', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'select', value: { value: 'Blue' } })
    ).toEqual({ value: 'Blue' })
  })

  it('respects an explicit { value } object over the numeric-id heuristic', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'select', value: { value: '2024' } })
    ).toEqual({ value: '2024' })
  })

  it('respects an explicit { id } object when serializing a select', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'select', value: { id: '10' } })
    ).toEqual({ id: '10' })
  })

  it('serializes a multiselect to an array of options', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'multiselect', value: ['Red', '42'] })
    ).toEqual([{ value: 'Red' }, { id: '42' }])
  })

  it('wraps a scalar multiselect value into a single-element array', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'multiselect', value: 'Only' })
    ).toEqual([{ value: 'Only' }])
  })

  it('serializes a userpicker to { accountId }', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'userpicker', value: 'acc-1' })
    ).toEqual({ accountId: 'acc-1' })
  })

  it('unwraps a { accountId } object for a userpicker', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'userpicker', value: { accountId: 'acc-1' } })
    ).toEqual({ accountId: 'acc-1' })
  })

  it('unwraps mixed scalar and { accountId } objects for a multiuserpicker', () => {
    expect(
      serializeJiraCustomField({
        fieldId: 'cf',
        type: 'multiuserpicker',
        value: [{ accountId: 'acc-1' }, 'acc-2'],
      })
    ).toEqual([{ accountId: 'acc-1' }, { accountId: 'acc-2' }])
  })

  it('serializes a multiuserpicker to an array of { accountId }', () => {
    expect(
      serializeJiraCustomField({
        fieldId: 'cf',
        type: 'multiuserpicker',
        value: ['acc-1', 'acc-2'],
      })
    ).toEqual([{ accountId: 'acc-1' }, { accountId: 'acc-2' }])
  })

  it('serializes cascading from an explicit child', () => {
    expect(
      serializeJiraCustomField({
        fieldId: 'cf',
        type: 'cascading',
        value: 'Americas',
        child: 'USA',
      })
    ).toEqual({ value: 'Americas', child: { value: 'USA' } })
  })

  it('serializes cascading from a { parent, child } object', () => {
    expect(
      serializeJiraCustomField({
        fieldId: 'cf',
        type: 'cascading',
        value: { parent: 'Americas', child: 'USA' },
      })
    ).toEqual({ value: 'Americas', child: { value: 'USA' } })
  })

  it('serializes cascading from a [parent, child] array', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'cascading', value: ['Americas', 'USA'] })
    ).toEqual({ value: 'Americas', child: { value: 'USA' } })
  })

  it('serializes cascading with no child to only { value }', () => {
    expect(
      serializeJiraCustomField({ fieldId: 'cf', type: 'cascading', value: 'Americas' })
    ).toEqual({ value: 'Americas' })
  })

  it('passes text through untouched', () => {
    expect(serializeJiraCustomField({ fieldId: 'cf', type: 'text', value: 'hello' })).toBe('hello')
  })

  it('coerces a numeric-string number to a number', () => {
    expect(serializeJiraCustomField({ fieldId: 'cf', type: 'number', value: '3.5' })).toBe(3.5)
  })

  it('leaves an already-numeric number untouched', () => {
    expect(serializeJiraCustomField({ fieldId: 'cf', type: 'number', value: 7 })).toBe(7)
  })

  it('passes a raw value through untouched, including complex shapes', () => {
    const raw = { some: ['arbitrary', { nested: true }] }
    expect(serializeJiraCustomField({ fieldId: 'cf', type: 'raw', value: raw })).toBe(raw)
  })
})

describe('buildJiraCustomFields', () => {
  it('normalizes a bare field id with the customfield_ prefix', () => {
    expect(
      buildJiraCustomFields({
        customFields: [{ fieldId: '10050', type: 'text', value: 'x' }],
      })
    ).toEqual({ customfield_10050: 'x' })
  })

  it('leaves an already-prefixed field id untouched', () => {
    expect(
      buildJiraCustomFields({
        customFields: [{ fieldId: 'customfield_10050', type: 'text', value: 'x' }],
      })
    ).toEqual({ customfield_10050: 'x' })
  })

  it('serializes a legacy single field as a raw passthrough', () => {
    expect(
      buildJiraCustomFields({ legacyFieldId: 'customfield_10001', legacyValue: 'legacy-value' })
    ).toEqual({ customfield_10001: 'legacy-value' })
  })

  it('skips the legacy field when id or value is empty', () => {
    expect(buildJiraCustomFields({ legacyFieldId: 'customfield_10001', legacyValue: '' })).toEqual(
      {}
    )
    expect(buildJiraCustomFields({ legacyFieldId: '', legacyValue: 'x' })).toEqual({})
  })

  it('lets a customFields entry win over a colliding legacy field', () => {
    expect(
      buildJiraCustomFields({
        legacyFieldId: 'customfield_10001',
        legacyValue: 'legacy-value',
        customFields: [{ fieldId: 'customfield_10001', type: 'select', value: 'High' }],
      })
    ).toEqual({ customfield_10001: { value: 'High' } })
  })

  it('merges legacy and non-colliding customFields entries', () => {
    expect(
      buildJiraCustomFields({
        legacyFieldId: 'customfield_10001',
        legacyValue: 'legacy',
        customFields: [{ fieldId: 'customfield_10002', type: 'userpicker', value: 'acc-1' }],
      })
    ).toEqual({
      customfield_10001: 'legacy',
      customfield_10002: { accountId: 'acc-1' },
    })
  })

  it('skips blank non-raw entries but keeps raw passthroughs', () => {
    expect(
      buildJiraCustomFields({
        customFields: [
          { fieldId: 'customfield_1', type: 'select', value: '' },
          { fieldId: 'customfield_2', type: 'raw', value: null },
        ],
      })
    ).toEqual({ customfield_2: null })
  })
})
