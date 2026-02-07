import { getEnv, isTruthy } from '@/lib/core/config/env'
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
    if (subBlock.mode === 'advanced') {
      group.advancedIds.push(subBlock.id)
    } else {
      group.basicId = subBlock.id
    }
    canonicalIdBySubBlockId[subBlock.id] = canonicalId
  })

  return { groupsById, canonicalIdBySubBlockId }
}

/**
 * Resolve if a canonical group is a swap pair (basic + advanced).
 */
export function isCanonicalPair(group?: CanonicalGroup): boolean {
  return Boolean(group?.basicId && group?.advancedIds?.length)
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
 * Check if a block has any standalone advanced-only fields (not part of canonical pairs).
 * These require the block-level advanced mode toggle to be visible.
 */
export function hasStandaloneAdvancedFields(
  subBlocks: SubBlockConfig[],
  canonicalIndex: CanonicalIndex
): boolean {
  for (const subBlock of subBlocks) {
    if (subBlock.mode !== 'advanced') continue
    if (!canonicalIndex.canonicalIdBySubBlockId[subBlock.id]) return true
  }
  return false
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

    if (subBlock.mode === 'advanced' && isNonEmptyValue(values[subBlock.id])) {
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
  if (subBlock.mode === 'advanced' && !displayAdvancedOptions) return false
  return true
}

/**
 * Resolve the dependency value for a dependsOn key, honoring canonical swaps.
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
  if (mode === 'advanced') return advancedValue ?? basicValue
  return basicValue ?? advancedValue
}

/**
 * Check if a subblock is gated by a feature flag.
 */
export function isSubBlockFeatureEnabled(subBlock: SubBlockConfig): boolean {
  if (!subBlock.requiresFeature) return true
  return isTruthy(getEnv(subBlock.requiresFeature))
}
