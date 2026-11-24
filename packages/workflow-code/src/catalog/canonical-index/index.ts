/**
 * The pure core of basic/advanced canonical pairs and subBlock visibility conditions, shared by
 * `apps/sim/lib/workflows/subblocks/visibility.ts` (which re-exports it, so the logic exists once)
 * and canonicalize, which runs it over catalog subBlocks instead of registry configs.
 *
 * Inputs are structural (`CanonicalIndexSubBlock`, `SubBlockCondition`), so a registry
 * `SubBlockConfig` and a `CatalogSubBlock` both fit.
 */

import { setOwn } from '../../records'
import { evaluateClause, recordLookup } from '../conditions'
import type { OpaqueMarker } from '../types'

export type CanonicalMode = 'basic' | 'advanced'

export interface CanonicalGroup {
  canonicalId: string
  basicId?: string
  advancedIds: string[]
}

export interface CanonicalIndex {
  groupsById: Record<string, CanonicalGroup>
  canonicalIdBySubBlockId: Record<string, string>
}

export interface SubBlockCondition {
  field: string
  value: string | number | boolean | Array<string | number | boolean> | undefined
  not?: boolean
  and?: SubBlockCondition
}

export interface CanonicalModeOverrides {
  [canonicalId: string]: CanonicalMode | undefined
}

interface CanonicalValueSelection {
  basicValue: unknown
  advancedValue: unknown
  advancedSourceId?: string
}

/** The subBlock fields the canonical index reads. */
interface CanonicalIndexSubBlock {
  id: string
  mode?: 'basic' | 'advanced' | 'both' | 'trigger' | 'trigger-advanced'
  canonicalParamId?: string
}

/**
 * A visibility condition: the object form, a registry function (evaluated against the values),
 * or a catalog `{ opaque: true }` marker for a function the projection could not evaluate. An
 * opaque condition counts as satisfied, so its field is treated as active.
 */
type EvaluableSubBlockCondition =
  | SubBlockCondition
  | OpaqueMarker
  | ((values?: Record<string, unknown>) => SubBlockCondition)
  | undefined

/** Build canonical group indices for a block's subblocks. */
export function buildCanonicalIndex(subBlocks: readonly CanonicalIndexSubBlock[]): CanonicalIndex {
  const groupsById: Record<string, CanonicalGroup> = {}
  const canonicalIdBySubBlockId: Record<string, string> = {}

  for (const subBlock of subBlocks) {
    if (!subBlock.canonicalParamId) continue
    const canonicalId = subBlock.canonicalParamId
    if (!groupsById[canonicalId]) {
      groupsById[canonicalId] = { canonicalId, advancedIds: [] }
    }
    const group = groupsById[canonicalId]
    if (subBlock.mode === 'advanced' || subBlock.mode === 'trigger-advanced') {
      // Trigger spreads may repeat the same advanced id as the regular block.
      if (!group.advancedIds.includes(subBlock.id)) {
        group.advancedIds.push(subBlock.id)
      }
    } else if (!group.basicId || subBlock.mode !== 'trigger') {
      // Blocks spread their trigger's subBlocks after their own, so a trigger-mode member never
      // takes a basicId a regular member already claimed.
      group.basicId = subBlock.id
    }
    canonicalIdBySubBlockId[subBlock.id] = canonicalId
  }

  return { groupsById, canonicalIdBySubBlockId }
}

/** Whether a canonical group is a swap pair (basic + advanced). */
export function isCanonicalPair(group?: CanonicalGroup): boolean {
  return Boolean(group?.basicId && group?.advancedIds?.length)
}

/** Whether a value counts as set for advanced visibility and mode inference. */
export function isNonEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

/** Resolve the basic and advanced values for a canonical group. */
export function getCanonicalValues(
  group: CanonicalGroup,
  values: Record<string, unknown>
): CanonicalValueSelection {
  const basicValue = group.basicId ? values[group.basicId] : undefined
  let advancedValue: unknown
  let advancedSourceId: string | undefined

  for (const advancedId of group.advancedIds) {
    const candidate = values[advancedId]
    if (isNonEmptyValue(candidate)) {
      advancedValue = candidate
      advancedSourceId = advancedId
      break
    }
  }

  return { basicValue, advancedValue, advancedSourceId }
}

/**
 * The active mode for a canonical group: an explicit override when the group has that member,
 * else the advanced member when only it holds a value, else basic.
 */
export function resolveCanonicalMode(
  group: CanonicalGroup,
  values: Record<string, unknown>,
  overrides?: CanonicalModeOverrides
): CanonicalMode {
  const override = overrides?.[group.canonicalId]
  if (override === 'advanced' && group.advancedIds.length > 0) return 'advanced'
  if (override === 'basic' && group.basicId) return 'basic'

  const { basicValue, advancedValue } = getCanonicalValues(group, values)
  const hasBasic = isNonEmptyValue(basicValue)
  const hasAdvanced = isNonEmptyValue(advancedValue)

  if (!group.basicId) return 'advanced'
  if (!hasBasic && hasAdvanced) return 'advanced'
  return 'basic'
}

function isOpaqueMarker(condition: object): condition is OpaqueMarker {
  return 'opaque' in condition && condition.opaque === true
}

/**
 * Evaluate a subblock condition against a map of raw values (`evaluateClause`, every field
 * known). Only one level of `and` is read, as in the registry.
 */
export function evaluateSubBlockCondition(
  condition: EvaluableSubBlockCondition,
  values: Record<string, unknown>
): boolean {
  if (!condition) return true
  const actual = typeof condition === 'function' ? condition(values) : condition
  if (isOpaqueMarker(actual)) return true
  return evaluateClause(actual, recordLookup(values)) === true
}

/** Extract override entries matching a `${prefix}` key into a bare-`canonicalId`-keyed object. */
function extractPrefixedModes(
  overrides: CanonicalModeOverrides,
  prefix: string
): CanonicalModeOverrides | undefined {
  let scoped: CanonicalModeOverrides | undefined
  for (const [key, value] of Object.entries(overrides)) {
    if (key.startsWith(prefix) && value) {
      scoped = scoped ?? {}
      setOwn(scoped, key.slice(prefix.length), value)
    }
  }
  return scoped
}

/**
 * The canonical-mode overrides of one nested tool, keyed by bare `canonicalId`. An agent block
 * stores its nested tools' modes as `${toolIndex}:${canonicalId}` (by position, so two tools of
 * the same type stay independent). The legacy `${legacyToolType}:` prefix is the baseline and
 * index-scoped entries are layered over it per canonical id, so a partially re-toggled legacy
 * tool keeps the ids the user has not re-toggled yet.
 *
 * Returns `undefined` when there are no overrides, no `toolIndex`, and no legacy match.
 */
export function scopeCanonicalModesForTool(
  overrides: CanonicalModeOverrides | undefined,
  toolIndex: number | undefined,
  legacyToolType?: string
): CanonicalModeOverrides | undefined {
  if (!overrides) return undefined
  const scoped =
    toolIndex !== undefined ? extractPrefixedModes(overrides, `${toolIndex}:`) : undefined
  const legacy = legacyToolType ? extractPrefixedModes(overrides, `${legacyToolType}:`) : undefined
  if (!scoped) return legacy
  return legacy ? { ...legacy, ...scoped } : scoped
}

const INDEX_SCOPED_KEY = /^(\d+):(.+)$/

/**
 * Carries each surviving tool's `${toolIndex}:${canonicalId}` overrides to its new position and
 * drops vacated indices, so a saved mode never attaches to a different tool that later lands on
 * the old index. Legacy `${toolType}:` keys are not positional and pass through unchanged.
 *
 * Returns the full replacement `canonicalModes` object (for an atomic whole-map write), or
 * `undefined` when nothing needs to change.
 */
export function reindexCanonicalModesByPosition(
  newIndexByOldIndex: ReadonlyMap<number, number>,
  overrides: CanonicalModeOverrides | undefined
): Record<string, CanonicalMode> | undefined {
  if (!overrides) return undefined

  let changed = false
  const result: Record<string, CanonicalMode> = {}
  for (const [key, mode] of Object.entries(overrides)) {
    if (!mode) continue
    const match = INDEX_SCOPED_KEY.exec(key)
    if (!match) {
      setOwn(result, key, mode)
      continue
    }
    const newIndex = newIndexByOldIndex.get(Number(match[1]))
    if (newIndex === undefined) {
      // Tool removed, or an already-stale index.
      changed = true
      continue
    }
    if (newIndex !== Number(match[1])) changed = true
    setOwn(result, `${newIndex}:${match[2]}`, mode)
  }
  return changed ? result : undefined
}
