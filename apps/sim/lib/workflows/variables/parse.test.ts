/**
 * @vitest-environment node
 *
 * Pins the contract between the two halves of every workflow export/import
 * round trip: `parseWorkflowVariables` produces what exports emit, and
 * `normalizeImportedVariables` consumes what imports receive. A shape the first
 * emits that the second drops is silent data loss on a restore, which is
 * exactly the bug the workspace importer shipped with.
 */

import { describe, expect, it } from 'vitest'
import { normalizeImportedVariables, parseWorkflowVariables } from '@/lib/workflows/variables/parse'

const VARIABLE = {
  id: 'var-1',
  name: 'apiHost',
  type: 'string' as const,
  value: 'https://example.com',
}

describe('parseWorkflowVariables', () => {
  it('returns undefined for null so callers can omit the field', () => {
    expect(parseWorkflowVariables(null)).toBeUndefined()
  })

  it('reads the current record form', () => {
    expect(parseWorkflowVariables({ 'var-1': VARIABLE })).toEqual({ 'var-1': VARIABLE })
  })

  it('re-keys the legacy array form by variable id', () => {
    expect(parseWorkflowVariables([VARIABLE] as never)).toEqual({ 'var-1': VARIABLE })
  })

  it('parses a JSON string column value', () => {
    expect(parseWorkflowVariables(JSON.stringify({ 'var-1': VARIABLE }) as never)).toEqual({
      'var-1': VARIABLE,
    })
  })

  it('skips legacy array rows without a usable id instead of emitting an "undefined" key', () => {
    const result = parseWorkflowVariables([VARIABLE, { name: 'orphan' }, null] as never)

    expect(Object.keys(result ?? {})).toEqual(['var-1'])
  })
})

describe('normalizeImportedVariables', () => {
  it('accepts the record form', () => {
    expect(normalizeImportedVariables({ 'var-1': VARIABLE })).toEqual({ 'var-1': VARIABLE })
  })

  it('accepts the legacy array form', () => {
    expect(normalizeImportedVariables([VARIABLE])).toEqual({ 'var-1': VARIABLE })
  })

  it('returns an empty record for null, undefined and non-objects', () => {
    expect(normalizeImportedVariables(null)).toEqual({})
    expect(normalizeImportedVariables(undefined)).toEqual({})
    expect(normalizeImportedVariables('nope')).toEqual({})
  })

  it('falls back to the map key when an entry carries no id', () => {
    expect(normalizeImportedVariables({ fromKey: { name: 'x', value: 1 } })).toMatchObject({
      fromKey: { id: 'fromKey', name: 'x' },
    })
  })

  it('coerces an unrecognized type to string rather than persisting it', () => {
    const result = normalizeImportedVariables({ v: { ...VARIABLE, type: 'secret' } })

    expect(result['var-1'].type).toBe('string')
  })

  it('keeps a __proto__-keyed variable as an ordinary own property', () => {
    /**
     * Built via `JSON.parse` rather than a literal: an object literal's
     * `__proto__` sets the prototype, while `JSON.parse` creates a real own
     * key — and `JSON.parse` is how an import payload actually arrives.
     */
    const payload = JSON.parse('{"__proto__": {"name": "sneaky", "value": 1}}')

    const result = normalizeImportedVariables(payload)

    expect(Object.keys(result)).toContain('__proto__')
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  it('trims a padded id so the key is referenceable', () => {
    expect(Object.keys(normalizeImportedVariables([{ ...VARIABLE, id: '  var-1  ' }]))).toEqual([
      'var-1',
    ])
  })

  it('skips non-object entries instead of writing junk variables', () => {
    expect(normalizeImportedVariables(['nope', null, VARIABLE])).toEqual({ 'var-1': VARIABLE })
  })
})

describe('export -> import variable round trip', () => {
  /**
   * The regression guard. Workspace export writes whatever
   * `parseWorkflowVariables` returns — the record form — and the importer used
   * to guard on `Array.isArray`, so every variable was silently dropped on
   * restore.
   */
  it('survives the record form that exports actually emit', () => {
    const exported = parseWorkflowVariables({ 'var-1': VARIABLE })

    expect(exported).toBeDefined()
    expect(Array.isArray(exported)).toBe(false)
    expect(normalizeImportedVariables(exported)).toEqual({ 'var-1': VARIABLE })
  })

  it('survives a legacy array-form export', () => {
    const exported = parseWorkflowVariables([VARIABLE] as never)

    expect(normalizeImportedVariables(exported)).toEqual({ 'var-1': VARIABLE })
  })
})
