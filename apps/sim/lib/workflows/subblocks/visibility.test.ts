import { describe, expect, it } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import {
  buildCanonicalIndexForSurface,
  evaluateSubBlockCondition,
  getCanonicalSubBlocksForSurface,
  reindexRewrittenToolCanonicalModes,
  reindexToolCanonicalModes,
  resolveActiveDependencyValue,
  resolveDependencyValue,
  scopeCanonicalModesForTool,
} from './visibility'

describe('evaluateSubBlockCondition', () => {
  describe('simple value matching', () => {
    it.concurrent('returns true when field value matches condition value', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when field is missing', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = {}
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('array value matching', () => {
    it.concurrent('returns true when field value is in condition array', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })
  })

  describe('negation with not flag', () => {
    it.concurrent('returns false when field matches but not is true', () => {
      const condition = { field: 'operation', value: 'create_booking', not: true }
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
  })

  describe('edge cases', () => {
    it.concurrent('passes current values into function conditions', () => {
      const condition = (values?: Record<string, unknown>) => ({
        field: 'model',
        value: typeof values?.model === 'string' ? values.model : '__no_model_selected__',
      })
      const values = { model: 'ollama/gemma3:4b' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })
  })
})

describe('scopeCanonicalModesForTool', () => {
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

  it.concurrent('keeps legacy modes for canonical ids the user has not re-toggled', () => {
    // Toggles are written one key at a time, so the first toggle on a legacy tool leaves a map
    // holding both formats. Returning only the index-scoped side reverted every canonical id the
    // user had not yet touched back to basic.
    const overrides = {
      'table:tableId': 'advanced' as const,
      'table:conflictColumn': 'advanced' as const,
      '0:conflictColumn': 'basic' as const,
    }
    expect(scopeCanonicalModesForTool(overrides, 0, 'table')).toEqual({
      tableId: 'advanced',
      conflictColumn: 'basic',
    })
  })
})

describe('reindexToolCanonicalModes', () => {
  // Generic over T - only object identity matters, so a plain marker object stands in for a
  // real StoredTool/fork-parsed-tool.
  const tool = (label: string) => ({ label })

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
})

describe('reindexRewrittenToolCanonicalModes', () => {
  /** Serialized tools: each call builds fresh objects, so object identity never matches. */
  const jira = (projectId: string, extra: Record<string, unknown> = {}) => ({
    type: 'jira',
    operation: 'jira_get_issue',
    params: { projectId },
    ...extra,
  })
  const gmail = () => ({ type: 'gmail', operation: 'gmail_send', params: {} })

  it.concurrent('moves each tool overrides with it when serialized tools are reordered', () => {
    const result = reindexRewrittenToolCanonicalModes(
      [jira('A'), jira('B')],
      [jira('B'), jira('A')],
      { '0:projectId': 'basic', '1:projectId': 'advanced' }
    )
    expect(result).toEqual({ '0:projectId': 'advanced', '1:projectId': 'basic' })
  })

  it.concurrent(
    'lets an edited tool claim its old slot after an unchanged tool moves past it',
    () => {
      const result = reindexRewrittenToolCanonicalModes(
        [jira('A'), gmail(), jira('B')],
        [gmail(), jira('B'), jira('A-edited')],
        { '0:projectId': 'advanced', '2:projectId': 'basic' }
      )
      expect(result).toEqual({ '1:projectId': 'basic', '2:projectId': 'advanced' })
    }
  )

  it.concurrent('drops a removed tool overrides and shifts the survivors', () => {
    const result = reindexRewrittenToolCanonicalModes(
      [jira('A'), jira('B'), jira('C')],
      [jira('B'), jira('C')],
      { '0:projectId': 'advanced', '1:projectId': 'basic', '2:projectId': 'advanced' }
    )
    expect(result).toEqual({ '0:projectId': 'basic', '1:projectId': 'advanced' })
  })

  it.concurrent('gives a new tool no overrides even when it lands on a used position', () => {
    const result = reindexRewrittenToolCanonicalModes([jira('A')], [gmail(), jira('A')], {
      '0:projectId': 'advanced',
    })
    expect(result).toEqual({ '1:projectId': 'advanced' })
  })

  it.concurrent('does not hand a replaced tool overrides to a tool of another type', () => {
    const result = reindexRewrittenToolCanonicalModes([jira('A')], [gmail()], {
      '0:projectId': 'advanced',
    })
    expect(result).toEqual({})
  })

  it.concurrent('keeps identical duplicates on their own positions', () => {
    const result = reindexRewrittenToolCanonicalModes(
      [jira('A'), jira('A')],
      [jira('A'), jira('A'), gmail()],
      { '0:projectId': 'basic', '1:projectId': 'advanced' }
    )
    expect(result).toBeUndefined()
  })
})

describe('canonical index scoping by surface', () => {
  /** Webflow's shape: an action pair and a trigger alias sharing one `canonicalParamId`. */
  const MIXED: SubBlockConfig[] = [
    { id: 'siteSelector', type: 'dropdown', canonicalParamId: 'siteId', mode: 'basic' },
    { id: 'manualSiteId', type: 'short-input', canonicalParamId: 'siteId', mode: 'advanced' },
    { id: 'triggerSiteId', type: 'dropdown', canonicalParamId: 'siteId', mode: 'trigger' },
  ] as SubBlockConfig[]

  it.concurrent('keeps the whole array on the action surface', () => {
    expect(getCanonicalSubBlocksForSurface(MIXED, false)).toBe(MIXED)
  })

  it.concurrent('keeps only trigger members on the trigger surface', () => {
    expect(getCanonicalSubBlocksForSurface(MIXED, true).map((s) => s.id)).toEqual(['triggerSiteId'])
  })

  it.concurrent('makes the trigger alias its own group rather than a stranded member', () => {
    // Unscoped, `triggerSiteId` joins the action pair and matches neither side of it, so every
    // group-relative question about it answers for the dormant surface.
    const unscoped = buildCanonicalIndexForSurface(MIXED, false).groupsById.siteId
    expect(unscoped.basicId).toBe('siteSelector')
    expect(unscoped.advancedIds).toEqual(['manualSiteId'])

    const scoped = buildCanonicalIndexForSurface(MIXED, true).groupsById.siteId
    expect(scoped.basicId).toBe('triggerSiteId')
    expect(scoped.advancedIds).toEqual([])
  })

  it.concurrent('preserves a pair that lives entirely on the trigger surface', () => {
    const triggerPair: SubBlockConfig[] = [
      { id: 'calendarId', type: 'dropdown', canonicalParamId: 'calId', mode: 'trigger' },
      {
        id: 'manualCalendarId',
        type: 'short-input',
        canonicalParamId: 'calId',
        mode: 'trigger-advanced',
      },
    ] as SubBlockConfig[]

    const group = buildCanonicalIndexForSurface(triggerPair, true).groupsById.calId
    expect(group.basicId).toBe('calendarId')
    expect(group.advancedIds).toEqual(['manualCalendarId'])
  })
})

describe('resolveActiveDependencyValue', () => {
  /** The File block's folder scope: a multi-select picker paired with a typed list. */
  const SCOPE_PAIR: SubBlockConfig[] = [
    {
      id: 'folderSelection',
      type: 'folder-selector',
      canonicalParamId: 'folderScopeRef',
      mode: 'basic',
    },
    {
      id: 'manualFolderSelection',
      type: 'short-input',
      canonicalParamId: 'folderScopeRef',
      mode: 'advanced',
    },
    { id: 'query', type: 'short-input' },
  ] as SubBlockConfig[]
  const index = buildCanonicalIndexForSurface(SCOPE_PAIR, false)

  it.concurrent(
    'answers with the active half whether addressed by a member or the canonical id',
    () => {
      const values = { folderSelection: ['/Reports'], manualFolderSelection: '/Archive' }
      const advanced = { folderScopeRef: 'advanced' as const }
      const basic = { folderScopeRef: 'basic' as const }

      expect(resolveActiveDependencyValue('folderSelection', values, index, advanced)).toBe(
        '/Archive'
      )
      expect(resolveActiveDependencyValue('folderScopeRef', values, index, advanced)).toBe(
        '/Archive'
      )
      expect(resolveActiveDependencyValue('manualFolderSelection', values, index, basic)).toEqual([
        '/Reports',
      ])
    }
  )

  // A picker scoped by the dormant half would offer a set the run then ignores: the
  // serializer publishes only the active member, so the strict reading is the one that
  // matches execution. The dependency fallback exists for `dependsOn` gating and reaches
  // for the other half whenever the active one was never touched.
  it.concurrent('never leaks a dormant half, unlike the dependency fallback', () => {
    const untouched = { manualFolderSelection: '/Archive' }
    const cleared = { folderSelection: '', manualFolderSelection: '/Archive' }
    const basic = { folderScopeRef: 'basic' as const }

    expect(resolveActiveDependencyValue('folderSelection', untouched, index, basic)).toBeUndefined()
    expect(resolveActiveDependencyValue('folderSelection', cleared, index, basic)).toBe('')
    expect(resolveDependencyValue('folderSelection', untouched, index, basic)).toBe('/Archive')
  })
})
