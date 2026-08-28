import { getSelectorManifestEntry, type SelectorKey } from '@/lib/selectors/manifest'
import {
  type SelectorContext,
  type SelectorContextKey,
  selectorContextKeys,
} from '@/lib/selectors/types'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  resolveActiveCanonicalValue,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { isReference } from '@/executor/constants'
import type { SubBlockState } from '@/stores/workflows/workflow/types'

export const SELECTOR_CONTEXT_FIELDS = new Set<SelectorContextKey>(selectorContextKeys)
const EXPLICIT_SELECTOR_HINT_FIELDS = ['impersonateUserEmail'] as const

function isSurfaceSubBlock(subBlock: SubBlockConfig, triggerMode: boolean): boolean {
  const triggerField = subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced'
  return triggerMode ? triggerField : !triggerField
}

export function getSelectorContextSubBlocks(
  subBlocks: SubBlockConfig[],
  values: Record<string, unknown>,
  triggerMode = false
): SubBlockConfig[] {
  return subBlocks.filter(
    (subBlock) =>
      isSurfaceSubBlock(subBlock, triggerMode) &&
      evaluateSubBlockCondition(subBlock.condition, values)
  )
}

function toContextValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const normalized = typeof value === 'string' ? value : String(value)
  if (!normalized || isReference(normalized) || /<[^<>]+>/.test(normalized)) return undefined
  return normalized
}

export function projectSelectorContext(
  selectorKey: SelectorKey,
  candidate: object
): SelectorContext {
  const manifest = getSelectorManifestEntry(selectorKey)
  const allowed = new Set<string>(manifest.context.allowed)
  const source = candidate as Record<string, unknown>
  const projectedCandidate: Record<string, unknown> = { ...source }

  if (projectedCandidate.oauthCredential === undefined) {
    projectedCandidate.oauthCredential =
      source.credential ??
      source.botCredential ??
      source.customBotCredential ??
      source.manualBotCredential
  }
  for (const [target, sourceFields] of Object.entries(manifest.context.sourceFields ?? {})) {
    for (const sourceField of sourceFields ?? []) {
      const value = toContextValue(source[sourceField])
      if (value === undefined) continue
      projectedCandidate[target] = value
      break
    }
  }

  const context: SelectorContext = {}
  for (const [field, value] of Object.entries(projectedCandidate)) {
    if (!allowed.has(field)) continue
    const normalized = toContextValue(value)
    if (normalized !== undefined) context[field as SelectorContextKey] = normalized
  }
  return context
}

export interface BuildSelectorRawContextInput {
  selectorKey: SelectorKey
  blockType: string
  subBlocks: Record<string, SubBlockState | { value?: unknown }>
  dependsOn?: readonly string[]
  canonicalModes?: CanonicalModeOverrides
  triggerMode?: boolean
  staticContext?: Readonly<Record<string, unknown>>
}

export interface BuildSelectorContextFromValuesInput {
  selectorKey: SelectorKey
  contextConfigs: SubBlockConfig[]
  values: Record<string, unknown>
  dependsOn?: readonly string[]
  canonicalIndex?: ReturnType<typeof buildCanonicalIndex>
  canonicalModes?: CanonicalModeOverrides
  staticContext?: Readonly<Record<string, unknown>>
}

/** Shared active-value projection used by every selector surface. */
export function buildSelectorContextFromValues(
  input: BuildSelectorContextFromValuesInput
): SelectorContext {
  const manifest = getSelectorManifestEntry(input.selectorKey)
  const allowed = new Set<string>(manifest.context.allowed)
  const canonicalIndex = input.canonicalIndex ?? buildCanonicalIndex(input.contextConfigs)
  const configById = new Map(input.contextConfigs.map((config) => [config.id, config]))
  const dependencies = input.dependsOn ? new Set(input.dependsOn) : null
  const candidate: Record<string, unknown> = { ...(input.staticContext ?? {}) }
  const resolvedGroups = new Set<string>()

  const includeSubBlock = (subBlockId: string, canonicalId?: string): boolean => {
    if (!dependencies) return true
    return (
      dependencies.has(subBlockId) || (canonicalId !== undefined && dependencies.has(canonicalId))
    )
  }

  const includeValue = (subBlockId: string, value: unknown) => {
    const config = configById.get(subBlockId)
    if (!config) return
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockId]
    if (!includeSubBlock(subBlockId, canonicalId)) return

    if (canonicalId) {
      if (resolvedGroups.has(canonicalId)) return
      resolvedGroups.add(canonicalId)
      candidate[canonicalId] = resolveActiveCanonicalValue(
        canonicalIndex.groupsById[canonicalId],
        input.values,
        input.canonicalModes
      )
      return
    }
    candidate[subBlockId] = value
  }

  if (dependencies) {
    for (const dependency of dependencies) {
      const canonicalId =
        canonicalIndex.groupsById[dependency]?.canonicalId ??
        canonicalIndex.canonicalIdBySubBlockId[dependency]
      if (canonicalId) {
        if (resolvedGroups.has(canonicalId)) continue
        resolvedGroups.add(canonicalId)
        candidate[canonicalId] = resolveActiveCanonicalValue(
          canonicalIndex.groupsById[canonicalId],
          input.values,
          input.canonicalModes
        )
        continue
      }
      if (!configById.has(dependency)) continue
      candidate[dependency] = input.values[dependency]
    }
  } else {
    for (const [subBlockId, value] of Object.entries(input.values)) {
      includeValue(subBlockId, value)
    }
  }

  for (const hint of EXPLICIT_SELECTOR_HINT_FIELDS) {
    if (allowed.has(hint)) candidate[hint] = input.values[hint]
  }

  return projectSelectorContext(input.selectorKey, candidate)
}

export function buildSelectorRawContext(input: BuildSelectorRawContextInput): SelectorContext {
  const blockConfig = getBlock(input.blockType)
  if (!blockConfig) return projectSelectorContext(input.selectorKey, input.staticContext ?? {})

  const values = buildSubBlockValues(input.subBlocks)
  const contextConfigs = getSelectorContextSubBlocks(
    blockConfig.subBlocks,
    values,
    input.triggerMode
  )
  return buildSelectorContextFromValues({
    selectorKey: input.selectorKey,
    contextConfigs,
    values,
    dependsOn: input.dependsOn,
    canonicalModes: input.canonicalModes,
    staticContext: input.staticContext,
  })
}
