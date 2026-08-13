/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateSubBlockCondition,
  reindexToolCanonicalModes,
  scopeCanonicalModesForTool,
} from './visibility'

describe('evaluateSubBlockCondition', () => {
  describe('simple value matching', () => {
    it.concurrent('returns true when field value matches condition value', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when field value does not match condition value', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: 'cancel_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is missing', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = {}
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is undefined', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: undefined }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is null', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: null }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('array value matching', () => {
    it.concurrent('returns true when field value is in condition array', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns true for second array value', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: 'update_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when field value is not in condition array', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: 'cancel_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is undefined with array condition', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: undefined }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is null with array condition', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: null }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('negation with not flag', () => {
    it.concurrent('returns false when field matches but not is true', () => {
      const condition = { field: 'operation', value: 'create_booking', not: true }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns true when field does not match and not is true', () => {
      const condition = { field: 'operation', value: 'create_booking', not: true }
      const values = { operation: 'cancel_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns true when field is not in array and not is true', () => {
      const condition = {
        field: 'operation',
        value: ['create_booking', 'update_booking'],
        not: true,
      }
      const values = { operation: 'cancel_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when field is in array and not is true', () => {
      const condition = {
        field: 'operation',
        value: ['create_booking', 'update_booking'],
        not: true,
      }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('compound conditions with and', () => {
    it.concurrent('returns true when both conditions match', () => {
      const condition = {
        field: 'operation',
        value: 'create_booking',
        and: { field: 'hasEmail', value: true },
      }
      const values = { operation: 'create_booking', hasEmail: true }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when first condition matches but and condition fails', () => {
      const condition = {
        field: 'operation',
        value: 'create_booking',
        and: { field: 'hasEmail', value: true },
      }
      const values = { operation: 'create_booking', hasEmail: false }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when first condition fails but and condition matches', () => {
      const condition = {
        field: 'operation',
        value: 'create_booking',
        and: { field: 'hasEmail', value: true },
      }
      const values = { operation: 'cancel_booking', hasEmail: true }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when both conditions fail', () => {
      const condition = {
        field: 'operation',
        value: 'create_booking',
        and: { field: 'hasEmail', value: true },
      }
      const values = { operation: 'cancel_booking', hasEmail: false }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it.concurrent('returns true when condition is undefined', () => {
      expect(evaluateSubBlockCondition(undefined, { operation: 'anything' })).toBe(true)
    })

    it.concurrent('handles function conditions', () => {
      const condition = () => ({ field: 'operation', value: 'create_booking' })
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('passes current values into function conditions', () => {
      const condition = (values?: Record<string, unknown>) => ({
        field: 'model',
        value: typeof values?.model === 'string' ? values.model : '__no_model_selected__',
      })
      const values = { model: 'ollama/gemma3:4b' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('handles boolean values', () => {
      const condition = { field: 'enabled', value: true }
      const values = { enabled: true }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('handles numeric values', () => {
      const condition = { field: 'count', value: 5 }
      const values = { count: 5 }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })
  })
})

describe('scopeCanonicalModesForTool', () => {
  it.concurrent('returns undefined when there are no overrides', () => {
    expect(scopeCanonicalModesForTool(undefined, 0)).toBeUndefined()
  })

  it.concurrent('returns undefined when toolIndex is undefined', () => {
    expect(scopeCanonicalModesForTool({ '0:tableId': 'advanced' }, undefined)).toBeUndefined()
  })

  it.concurrent('strips the toolIndex prefix for the matching tool instance', () => {
    const overrides = { '0:tableId': 'advanced', '1:tableId': 'basic' }
    expect(scopeCanonicalModesForTool(overrides, 0)).toEqual({ tableId: 'advanced' })
    expect(scopeCanonicalModesForTool(overrides, 1)).toEqual({ tableId: 'basic' })
  })

  it.concurrent(
    'keeps two same-type tool instances independent (regression: two Table tools on one Agent block used to share a mode)',
    () => {
      const overrides = { '0:tableId': 'advanced', '1:tableId': 'basic' }
      // Both tools have type "table" and canonicalId "tableId" - only toolIndex disambiguates them.
      expect(scopeCanonicalModesForTool(overrides, 0)).toEqual({ tableId: 'advanced' })
      expect(scopeCanonicalModesForTool(overrides, 1)).toEqual({ tableId: 'basic' })
    }
  )

  it.concurrent('returns undefined when no keys match the given toolIndex prefix', () => {
    expect(scopeCanonicalModesForTool({ '1:tableId': 'advanced' }, 0)).toBeUndefined()
  })

  it.concurrent('ignores falsy override values', () => {
    expect(
      scopeCanonicalModesForTool({ '0:tableId': undefined as unknown as 'advanced' }, 0)
    ).toBeUndefined()
  })

  it.concurrent(
    'falls back to the legacy toolType-scoped prefix when no index-scoped key matches',
    () => {
      // Saved before per-instance scoping shipped - must not be silently dropped.
      const legacyOverrides = { 'table:tableId': 'advanced' as const }
      expect(scopeCanonicalModesForTool(legacyOverrides, 0, 'table')).toEqual({
        tableId: 'advanced',
      })
      expect(scopeCanonicalModesForTool(legacyOverrides, 3, 'table')).toEqual({
        tableId: 'advanced',
      })
    }
  )

  it.concurrent('prefers an index-scoped key over the legacy type-scoped fallback', () => {
    const overrides = { 'table:tableId': 'advanced' as const, '0:tableId': 'basic' as const }
    expect(scopeCanonicalModesForTool(overrides, 0, 'table')).toEqual({ tableId: 'basic' })
  })

  it.concurrent('does not fall back when no legacyToolType is given', () => {
    expect(scopeCanonicalModesForTool({ 'table:tableId': 'advanced' }, 0)).toBeUndefined()
  })
})

describe('reindexToolCanonicalModes', () => {
  // Generic over T - only object identity matters, so a plain marker object stands in for a
  // real StoredTool/fork-parsed-tool.
  const tool = (label: string) => ({ label })

  it.concurrent('returns undefined when there are no overrides', () => {
    expect(reindexToolCanonicalModes([tool('a')], [tool('a')], undefined)).toBeUndefined()
  })

  it.concurrent('returns undefined when every tool keeps its index', () => {
    const a = tool('a')
    const b = tool('b')
    expect(reindexToolCanonicalModes([a, b], [a, b], { '0:tableId': 'advanced' })).toBeUndefined()
  })

  it.concurrent('re-keys a surviving tool overrides to its new index after a removal', () => {
    const a = tool('a')
    const b = tool('b')
    const c = tool('c')
    // Remove `a` (index 0): b shifts 1->0, c shifts 2->1.
    const result = reindexToolCanonicalModes([a, b, c], [b, c], {
      '1:tableId': 'advanced',
      '2:tableId': 'basic',
    })
    expect(result).toEqual({ '0:tableId': 'advanced', '1:tableId': 'basic' })
  })

  it.concurrent('re-keys overrides after a drag reorder (swap)', () => {
    const a = tool('a')
    const b = tool('b')
    // Swap a and b: a moves 0->1, b moves 1->0. A naive sequential re-key would have one
    // write clobber the other since both use the same canonicalId; this must resolve both
    // from the ORIGINAL snapshot into one atomic result.
    const result = reindexToolCanonicalModes([a, b], [b, a], {
      '0:tableId': 'advanced',
      '1:tableId': 'basic',
    })
    expect(result).toEqual({ '1:tableId': 'advanced', '0:tableId': 'basic' })
  })

  it.concurrent(
    'regression: drops a removed tool old key so a later tool cannot inherit it',
    () => {
      const a = tool('a')
      const b = tool('b')
      // Remove `b` (index 1): nothing survives at index 1 in the result, so a future tool
      // appended back into that slot won't silently inherit `b`'s old advanced mode.
      const result = reindexToolCanonicalModes([a, b], [a], { '1:tableId': 'advanced' })
      expect(result).toEqual({})
    }
  )

  it.concurrent('drops a stale index key with no corresponding old-array position', () => {
    // Simulates leftover pollution from before this fix (or an earlier missed clear):
    // index 5 doesn't correspond to any tool in `oldTools` at all.
    const a = tool('a')
    const result = reindexToolCanonicalModes([a], [a], {
      '5:tableId': 'advanced',
      '0:tableId': 'basic',
    })
    expect(result).toEqual({ '0:tableId': 'basic' })
  })

  it.concurrent('carries a legacy (non-index-scoped) key through unchanged', () => {
    const a = tool('a')
    const b = tool('b')
    // `table:tableId` isn't tied to any array position - removing/reordering tools must not
    // touch it.
    const result = reindexToolCanonicalModes([a, b], [b], {
      '0:tableId': 'advanced',
      'table:tableId': 'basic',
    })
    expect(result).toEqual({ 'table:tableId': 'basic' })
  })

  it.concurrent('ignores falsy override values', () => {
    const a = tool('a')
    const b = tool('b')
    const result = reindexToolCanonicalModes([a, b], [b, a], {
      '0:tableId': undefined as unknown as 'advanced',
    })
    expect(result).toBeUndefined()
  })
})
