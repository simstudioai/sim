import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import type { SubBlockConfig } from '@/blocks/types'

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

export interface CanonicalValueSelection {
  basicValue: unknown
  advancedValue: unknown
  advancedSourceId?: string
}

interface TriggerVisibilityBlockConfig {
  category?: string
  triggers?: {
    enabled?: boolean
  }
}

export function parseDependsOn(dependsOn: SubBlockConfig['dependsOn']): {
  allFields: string[]
  anyFields: string[]
  allDependsOnFields: string[]
} {
  if (!dependsOn) {
    return { allFields: [], anyFields: [], allDependsOnFields: [] }
  }

  if (Array.isArray(dependsOn)) {
    return { allFields: dependsOn, anyFields: [], allDependsOnFields: dependsOn }
  }

  const allFields = dependsOn.all || []
  const anyFields = dependsOn.any || []
  return {
    allFields,
    anyFields,
    allDependsOnFields: [...allFields, ...anyFields],
  }
}

export function normalizeDependencyValue(rawValue: unknown): unknown {
  if (rawValue === null || rawValue === undefined) return null

  if (typeof rawValue === 'object') {
    if (Array.isArray(rawValue)) {
      if (rawValue.length === 0) return null
      return rawValue.map((item) => normalizeDependencyValue(item))
    }

    const record = rawValue as Record<string, unknown>
    if ('value' in record) return normalizeDependencyValue(record.value)
    if ('id' in record) return record.id

    return record
  }

  return rawValue
}

/**
 * Build a flat map of subblock values keyed by subblock id.
 */
export function buildSubBlockValues(
  subBlocks: Record<string, { value?: unknown } | null | undefined>
): Record<string, unknown> {
  return Object.entries(subBlocks).reduce<Record<string, unknown>>((acc, [key, subBlock]) => {
    acc[key] = subBlock?.value
    return acc
  }, {})
}

/**
 * Build canonical group indices for a block's subblocks.
 */
export function buildCanonicalIndex(subBlocks: SubBlockConfig[]): CanonicalIndex {
  const groupsById: Record<string, CanonicalGroup> = {}
  const canonicalIdBySubBlockId: Record<string, string> = {}

  subBlocks.forEach((subBlock) => {
    if (!subBlock.canonicalParamId) return
    const canonicalId = subBlock.canonicalParamId
    if (!groupsById[canonicalId]) {
      groupsById[canonicalId] = { canonicalId, advancedIds: [] }
    }
    const group = groupsById[canonicalId]
    if (subBlock.mode === 'advanced' || subBlock.mode === 'trigger-advanced') {
      // Deduplicate: trigger spreads may repeat the same advanced ID as the regular block
      if (!group.advancedIds.includes(subBlock.id)) {
        group.advancedIds.push(subBlock.id)
      }
    } else {
      // A trigger-mode subblock must not overwrite a basicId already claimed by a non-trigger subblock.
      // Blocks spread their trigger's subBlocks after their own, so the regular subblock always wins.
      if (!group.basicId || subBlock.mode !== 'trigger') {
        group.basicId = subBlock.id
      }
    }
    canonicalIdBySubBlockId[subBlock.id] = canonicalId
  })

  return { groupsById, canonicalIdBySubBlockId }
}

/**
 * The subblocks that define a block's canonical groups on the surface it is being rendered or
 * resolved on.
 *
 * A block that is both an action and a trigger holds ONE `subBlocks` array: its own fields plus
 * its trigger's, spread in after them. Those two sets routinely share a `canonicalParamId` while
 * using DIFFERENT ids — Webflow's `siteSelector`/`manualSiteId` (action) and `triggerSiteId`
 * (trigger) are all `siteId`. Indexed together they collapse into one group whose `basicId`
 * belongs to the other surface, so the trigger member matches neither `basicId` nor `advancedIds`
 * and every group-relative question about it answers wrong: {@link isSubBlockVisibleForMode} hides
 * it outright, and {@link resolveDependencyValue} answers with the dormant surface's stale value.
 *
 * The serializer is deliberately exempt and keeps the unscoped index: `shouldSerializeSubBlock`
 * drops the inactive surface's members BEFORE the canonical collapse reads them, so it resolves
 * against a value map the dormant surface cannot appear in. That filter-then-resolve ordering is
 * the whole reason execution has always been correct here. Every other caller resolves against the
 * block's FULL value map, so for them the scoping has to live in the index instead.
 *
 * Only the trigger surface is filtered. The action surface keeps the whole array because a trigger
 * member is already excluded by each caller's own trigger-mode filter, and because dropping it
 * would also drop the `canonicalIdBySubBlockId` entry that lets a legacy alias still resolve
 * through {@link resolveDependencyValue}. Mirrors `getSelectorContextSubBlocks`.
 */
export function getCanonicalSubBlocksForSurface(
  subBlocks: SubBlockConfig[],
  triggerSurface: boolean
): SubBlockConfig[] {
  if (!triggerSurface) return subBlocks
  return subBlocks.filter(shouldUseSubBlockForTriggerModeCanonicalIndex)
}

/** {@link buildCanonicalIndex} over {@link getCanonicalSubBlocksForSurface}'s active set. */
export function buildCanonicalIndexForSurface(
  subBlocks: SubBlockConfig[],
  triggerSurface: boolean
): CanonicalIndex {
  return buildCanonicalIndex(getCanonicalSubBlocksForSurface(subBlocks, triggerSurface))
}

/**
 * Resolve if a canonical group is a swap pair (basic + advanced).
 */
export function isCanonicalPair(group?: CanonicalGroup): boolean {
  return Boolean(group?.basicId && group?.advancedIds?.length)
}

/**
 * Builds default canonical mode overrides for a block's subblocks.
 * All canonical pairs default to `'basic'`.
 */
export function buildDefaultCanonicalModes(
  subBlocks: SubBlockConfig[]
): Record<string, 'basic' | 'advanced'> {
  const index = buildCanonicalIndex(subBlocks)
  const modes: Record<string, 'basic' | 'advanced'> = {}
  for (const group of Object.values(index.groupsById)) {
    if (isCanonicalPair(group)) {
      modes[group.canonicalId] = 'basic'
    }
  }
  return modes
}

/**
 * Determine the active mode for a canonical group.
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

/**
 * Evaluate a subblock condition against a map of raw values.
 */
export function evaluateSubBlockCondition(
  condition:
    | SubBlockCondition
    | ((values?: Record<string, unknown>) => SubBlockCondition)
    | undefined,
  values: Record<string, unknown>
): boolean {
  if (!condition) return true
  const actual = typeof condition === 'function' ? condition(values) : condition
  const fieldValue = values[actual.field]
  const valueMatch = Array.isArray(actual.value)
    ? fieldValue != null &&
      (actual.not
        ? !actual.value.includes(fieldValue as any)
        : actual.value.includes(fieldValue as any))
    : actual.not
      ? fieldValue !== actual.value
      : fieldValue === actual.value
  const andMatch = !actual.and
    ? true
    : (() => {
        const andFieldValue = values[actual.and!.field]
        const andValueMatch = Array.isArray(actual.and!.value)
          ? andFieldValue != null &&
            (actual.and!.not
              ? !actual.and!.value.includes(andFieldValue as any)
              : actual.and!.value.includes(andFieldValue as any))
          : actual.and!.not
            ? andFieldValue !== actual.and!.value
            : andFieldValue === actual.and!.value
        return andValueMatch
      })()

  return valueMatch && andMatch
}

/**
 * Check if a value is considered set for advanced visibility/selection.
 */
export function isNonEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

/**
 * Resolve basic and advanced values for a canonical group.
 */
export function getCanonicalValues(
  group: CanonicalGroup,
  values: Record<string, unknown>
): CanonicalValueSelection {
  const basicValue = group.basicId ? values[group.basicId] : undefined
  let advancedValue: unknown
  let advancedSourceId: string | undefined

  group.advancedIds.forEach((advancedId) => {
    if (advancedValue !== undefined) return
    const candidate = values[advancedId]
    if (isNonEmptyValue(candidate)) {
      advancedValue = candidate
      advancedSourceId = advancedId
    }
  })

  return { basicValue, advancedValue, advancedSourceId }
}

/**
 * Resolve the ACTIVE canonical member's value for a group: the basic value in basic mode, the
 * advanced value in advanced mode (per {@link resolveCanonicalMode} - honoring an explicit
 * override, then the value heuristic). Strict: returns ONLY the active member's value with no
 * cross-mode fallback, so a dormant mode's stale value can never leak. The single source of truth
 * for "what value is live for this canonical pair" - use it instead of basic-first `||` /
 * `?? 'basic'` reads or last-write-wins scans.
 */
export function resolveActiveCanonicalValue(
  group: CanonicalGroup,
  values: Record<string, unknown>,
  overrides?: CanonicalModeOverrides
): unknown {
  const mode = resolveCanonicalMode(group, values, overrides)
  const { basicValue, advancedValue } = getCanonicalValues(group, values)
  return mode === 'advanced' ? advancedValue : basicValue
}

/**
 * {@link resolveActiveCanonicalValue} addressed by a canonical id or by a member's subblock id,
 * for a control that reads a SIBLING field without knowing whether that field is half of a pair.
 *
 * Strict like its namesake: a pair answers with its active member only, honoring an explicit
 * toggle, so a dormant half's stale value never scopes a control the run will not scope. A key
 * outside any group reads its own stored value. Contrast {@link resolveDependencyValue}, whose
 * cross-mode fallback exists for `dependsOn` gating and is wrong here.
 */
export function resolveActiveDependencyValue(
  dependencyKey: string,
  values: Record<string, unknown>,
  canonicalIndex: CanonicalIndex,
  overrides?: CanonicalModeOverrides
): unknown {
  const canonicalId =
    canonicalIndex.groupsById[dependencyKey]?.canonicalId ||
    canonicalIndex.canonicalIdBySubBlockId[dependencyKey]
  const group = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined
  if (!group) return values[dependencyKey]
  return resolveActiveCanonicalValue(group, values, overrides)
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
      scoped[key.slice(prefix.length)] = value
    }
  }
  return scoped
}

/**
 * Strip the `${toolIndex}:` prefix from canonical-mode override keys, returning the overrides for a
 * nested tool keyed by bare `canonicalId`. An agent block stores its nested tools' modes scoped as
 * `${toolIndex}:${canonicalId}` — keyed by the tool's position in the `tool-input` array, not its
 * `type` — so that two tool entries of the SAME type (e.g. two Table tools on one Agent block) get
 * independent canonical modes instead of colliding on a shared `${toolType}:${canonicalId}` key.
 *
 * The legacy `${legacyToolType}:` prefix (the pre-instance-scoping format) is the BASELINE, with
 * index-scoped entries layered over it per canonical id, so an override saved before this scoping
 * change isn't silently dropped - it keeps applying (type-shared, the old behavior) until the user
 * re-toggles that specific canonical id, at which point the new index-scoped key wins for it alone.
 *
 * Merging per key rather than preferring one map wholesale is what keeps a PARTIALLY re-toggled
 * tool intact. Toggles are written one key at a time (`setBlockCanonicalMode`), so the first toggle
 * on a legacy tool produces a map holding both formats; returning only the index-scoped side there
 * would silently revert every canonical id the user had not yet re-toggled back to basic.
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
 * Canonical-mode overrides are keyed by a tool's position in its `tool-input` array
 * (`${toolIndex}:${canonicalId}`), so anything that reorders or removes tools - the editor
 * (drag-reorder, remove, delete), fork/promote copy (dropping an unresolved custom-tool/MCP
 * entry) - must carry each surviving tool's overrides to its new position and DROP the
 * vacated index. Otherwise a saved basic/advanced choice can attach to whichever DIFFERENT
 * tool later lands on that old index (e.g. a newly-added tool, always appended at the end,
 * can refill a slot a removal just freed).
 *
 * Returns the full replacement `canonicalModes` object (for an atomic whole-map write - a
 * per-key merge can't drop a key, and sequential per-key writes can clobber each other when
 * two tools swap positions), or `undefined` when nothing needs to change. A legacy,
 * non-index-scoped key (the `${toolType}:` fallback format) isn't tied to any array position,
 * so it's carried over unchanged.
 */
export function reindexCanonicalModesByPosition(
  newIndexByOldIndex: ReadonlyMap<number, number>,
  overrides: CanonicalModeOverrides | undefined
): Record<string, 'basic' | 'advanced'> | undefined {
  if (!overrides) return undefined

  let changed = false
  const result: Record<string, 'basic' | 'advanced'> = {}
  for (const [key, mode] of Object.entries(overrides)) {
    if (!mode) continue
    const match = INDEX_SCOPED_KEY.exec(key)
    if (!match) {
      result[key] = mode
      continue
    }
    const newIndex = newIndexByOldIndex.get(Number(match[1]))
    if (newIndex === undefined) {
      changed = true // Tool removed (or an already-stale index) - drop the key.
      continue
    }
    if (newIndex !== Number(match[1])) changed = true
    result[`${newIndex}:${match[2]}`] = mode
  }
  return changed ? result : undefined
}

/**
 * {@link reindexCanonicalModesByPosition}, diffing `oldTools` against `newTools` by OBJECT
 * IDENTITY to derive the old-index -> new-index map. Callers must not clone the tool objects
 * they keep (only filter/splice/reorder the array itself) - a kept-but-cloned tool (e.g. a
 * `{ ...tool, someField: x }` spread) won't match its old reference and will be treated as
 * removed. Use {@link reindexCanonicalModesByPosition} directly when a caller's remap can
 * clone kept entries (fork/promote does, to rewrite a remapped id) and already knows each
 * surviving old index's new position by other means (e.g. tracking it during the same pass
 * that builds the new array, rather than post-hoc identity comparison).
 */
export function reindexToolCanonicalModes<T>(
  oldTools: readonly T[],
  newTools: readonly T[],
  overrides: CanonicalModeOverrides | undefined
): Record<string, 'basic' | 'advanced'> | undefined {
  const newIndexByRef = new Map(newTools.map((tool, index) => [tool, index]))
  const newIndexByOldIndex = new Map<number, number>()
  oldTools.forEach((tool, oldIndex) => {
    const newIndex = newIndexByRef.get(tool)
    if (newIndex !== undefined) newIndexByOldIndex.set(oldIndex, newIndex)
  })
  return reindexCanonicalModesByPosition(newIndexByOldIndex, overrides)
}

/**
 * True for the modes that make a field advanced-only when it is not part of a
 * canonical basic/advanced pair: a standalone `advanced` field, or a standalone
 * `trigger-advanced` field (an advanced option on a trigger block). Both are
 * hidden until the block-level advanced toggle is on.
 */
export function isStandaloneAdvancedMode(mode: SubBlockConfig['mode']): boolean {
  return mode === 'advanced' || mode === 'trigger-advanced'
}

/**
 * Check if any advanced-only or canonical advanced values are present.
 */
export function hasAdvancedValues(
  subBlocks: SubBlockConfig[],
  values: Record<string, unknown>,
  canonicalIndex: CanonicalIndex
): boolean {
  const checkedCanonical = new Set<string>()

  for (const subBlock of subBlocks) {
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlock.id]
    if (canonicalId) {
      const group = canonicalIndex.groupsById[canonicalId]
      if (group && isCanonicalPair(group) && !checkedCanonical.has(canonicalId)) {
        checkedCanonical.add(canonicalId)
        const { advancedValue } = getCanonicalValues(group, values)
        if (isNonEmptyValue(advancedValue)) return true
      }
      continue
    }

    if (isStandaloneAdvancedMode(subBlock.mode) && isNonEmptyValue(values[subBlock.id])) {
      return true
    }
  }

  return false
}

/**
 * Determine whether a subblock is visible based on mode and canonical swaps.
 */
export function isSubBlockVisibleForMode(
  subBlock: SubBlockConfig,
  displayAdvancedOptions: boolean,
  canonicalIndex: CanonicalIndex,
  values: Record<string, unknown>,
  overrides?: CanonicalModeOverrides
): boolean {
  const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlock.id]
  const group = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined

  if (group && isCanonicalPair(group)) {
    const mode = resolveCanonicalMode(group, values, overrides)
    if (mode === 'advanced') return group.advancedIds.includes(subBlock.id)
    return group.basicId === subBlock.id
  }

  if (subBlock.mode === 'basic' && displayAdvancedOptions) return false
  // Standalone advanced-only fields (`advanced` or a trigger's `trigger-advanced`)
  // hide until the block-level advanced toggle is on.
  if (isStandaloneAdvancedMode(subBlock.mode) && !displayAdvancedOptions) return false
  return true
}

export function isTriggerModeSubBlock(subBlock: Pick<SubBlockConfig, 'mode'>): boolean {
  return subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced'
}

export function isTriggerConfigSubBlock(subBlock: Pick<SubBlockConfig, 'type'>): boolean {
  return String(subBlock.type) === 'trigger-config'
}

export function shouldUseSubBlockForTriggerModeCanonicalIndex(
  subBlock: Pick<SubBlockConfig, 'mode' | 'type'>
): boolean {
  return isTriggerModeSubBlock(subBlock) || isTriggerConfigSubBlock(subBlock)
}

export function isPureTriggerBlockConfig(blockConfig?: TriggerVisibilityBlockConfig): boolean {
  return Boolean(blockConfig?.triggers?.enabled && blockConfig.category === 'triggers')
}

export function isSubBlockVisibleForTriggerMode(
  subBlock: Pick<SubBlockConfig, 'mode' | 'type'>,
  displayTriggerMode: boolean,
  blockConfig?: TriggerVisibilityBlockConfig
): boolean {
  if (isTriggerConfigSubBlock(subBlock)) {
    return displayTriggerMode || isPureTriggerBlockConfig(blockConfig)
  }

  if (isTriggerModeSubBlock(subBlock)) return displayTriggerMode
  if (displayTriggerMode) return false
  return true
}

/**
 * Resolve what a `dependsOn` key currently points at, honoring canonical swaps.
 *
 * Deliberately PERMISSIVE, unlike {@link resolveActiveCanonicalValue}: it falls back across the
 * pair and then scans the group's other members, so a dependant stays satisfied whenever the group
 * holds a usable value anywhere. That is the right answer for a gate ("is my parent chosen yet?")
 * and the wrong answer for a value read ("what is live?") - use `resolveActiveCanonicalValue` for
 * the latter, which is why the two differ.
 *
 * Pass a {@link buildCanonicalIndexForSurface} index. The member scan predates surface scoping and
 * was how a trigger alias (`triggerCredentials` under an action `oauthCredential` group) used to be
 * found at all; a scoped index now makes that alias the group's own `basicId`, so the scan is left
 * only as the fallback for state the mode backfill has not reached. Handing it an UNSCOPED index on
 * a trigger-mode block puts the dormant action surface back in scan range.
 */
export function resolveDependencyValue(
  dependencyKey: string,
  values: Record<string, unknown>,
  canonicalIndex: CanonicalIndex,
  overrides?: CanonicalModeOverrides
): unknown {
  const canonicalId =
    canonicalIndex.groupsById[dependencyKey]?.canonicalId ||
    canonicalIndex.canonicalIdBySubBlockId[dependencyKey]

  if (!canonicalId) {
    return values[dependencyKey]
  }

  const group = canonicalIndex.groupsById[canonicalId]
  if (!group) return values[dependencyKey]

  const { basicValue, advancedValue } = getCanonicalValues(group, values)
  const mode = resolveCanonicalMode(group, values, overrides)
  const canonicalResult =
    mode === 'advanced' ? (advancedValue ?? basicValue) : (basicValue ?? advancedValue)

  if (canonicalResult != null) return canonicalResult

  for (const [memberId, memberCanonicalId] of Object.entries(
    canonicalIndex.canonicalIdBySubBlockId
  )) {
    if (memberCanonicalId === canonicalId && isNonEmptyValue(values[memberId])) {
      return values[memberId]
    }
  }

  return values[dependencyKey]
}

/**
 * Whether a subblock only applies when the block is used as an agent tool.
 *
 * `paramVisibility` filters what appears *inside* tool-input but cannot hide a
 * subblock from the canvas, so this is a separate axis rather than another
 * visibility level.
 */
export function isToolInputOnlySubBlock(subBlock: Pick<SubBlockConfig, 'context'>): boolean {
  return subBlock.context === 'tool-input'
}

/**
 * Whether any env var named by an env-gate spec is truthy.
 *
 * A gate may name several vars, comma-separated, meaning "any of these" — that
 * is what lets a renamed flag ship without every existing deployment losing the
 * field until it sets the new var. Shared by both gates so the two cannot
 * interpret their value differently.
 */
function anyEnvSet(spec: string): boolean {
  return spec.split(',').some((name) => isTruthy(getEnv(name.trim())))
}

/**
 * Check if a subblock is gated by a feature flag.
 */
export function isSubBlockFeatureEnabled(
  subBlock: Pick<SubBlockConfig, 'showWhenEnvSet'>
): boolean {
  if (!subBlock.showWhenEnvSet) return true
  return anyEnvSet(subBlock.showWhenEnvSet)
}

/**
 * Check if a subblock should be hidden based on environment conditions.
 * Covers two cases:
 * - `hideWhenHosted`: hidden when running on hosted Sim (tool API key fields)
 * - `hideWhenEnvSet`: hidden when a specific NEXT_PUBLIC_ env var is truthy
 *   (credential fields hidden when the deployment provides them server-side)
 */
export function isSubBlockHidden(
  subBlock: SubBlockConfig,
  options?: { hosted?: boolean }
): boolean {
  const hosted = options?.hosted ?? isHosted
  if (subBlock.hideWhenHosted && hosted) return true
  if (subBlock.hideWhenEnvSet && anyEnvSet(subBlock.hideWhenEnvSet)) return true
  return false
}
