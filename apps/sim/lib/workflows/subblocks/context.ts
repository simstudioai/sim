import {
  buildSelectorRawContext,
  getSelectorContextSubBlocks as getSharedSelectorContextSubBlocks,
  SELECTOR_CONTEXT_FIELDS,
} from '@/lib/selectors/context'
import type { SelectorKey } from '@/lib/selectors/manifest'
import type { SelectorContext } from '@/lib/selectors/types'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  type CanonicalModeOverrides,
  resolveActiveCanonicalValue,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { isReference } from '@/executor/constants'
import type { SubBlockState } from '@/stores/workflows/workflow/types'

export { SELECTOR_CONTEXT_FIELDS }

/**
 * Selects the block fields allowed to contribute to selector context for the active mode.
 */
export function getSelectorContextSubBlocks(
  subBlocks: SubBlockConfig[],
  values: Record<string, unknown>,
  triggerMode?: boolean
): SubBlockConfig[] {
  return getSharedSelectorContextSubBlocks(subBlocks, values, triggerMode)
}

/**
 * Builds a SelectorContext from a block's subBlocks using the canonical index.
 *
 * Iterates the active mode's subblocks, resolves each through canonicalIdBySubBlockId to get
 * the canonical key, then checks it against SELECTOR_CONTEXT_FIELDS.
 * This avoids hardcoding subblock IDs and automatically handles basic/advanced
 * renames.
 */
export function buildSelectorContextFromBlock(
  blockType: string,
  subBlocks: Record<string, SubBlockState | { value?: unknown }>,
  opts?: {
    workflowId?: string
    workspaceId?: string
    canonicalModes?: CanonicalModeOverrides
    triggerMode?: boolean
    selectorKey?: SelectorKey
    dependsOn?: readonly string[]
    staticContext?: Readonly<Record<string, unknown>>
  }
): SelectorContext {
  if (!opts?.selectorKey) {
    const context: SelectorContext & { workflowId?: string; workspaceId?: string } = {}
    if (opts?.workflowId) context.workflowId = opts.workflowId
    if (opts?.workspaceId) context.workspaceId = opts.workspaceId

    const blockConfig = getBlock(blockType)
    if (!blockConfig) return context
    const values = buildSubBlockValues(subBlocks)
    const configs = getSelectorContextSubBlocks(blockConfig.subBlocks, values, opts?.triggerMode)
    const configById = new Map(configs.map((config) => [config.id, config]))
    const canonicalIndex = buildCanonicalIndex(configs)
    const resolvedGroups = new Set<string>()

    const setField = (field: string, value: unknown) => {
      if (!SELECTOR_CONTEXT_FIELDS.has(field as keyof SelectorContext)) return
      if (value === null || value === undefined) return
      const normalized = typeof value === 'string' ? value : String(value)
      if (!normalized || isReference(normalized)) return
      context[field as keyof SelectorContext] = normalized
    }

    for (const [subBlockId, subBlock] of Object.entries(subBlocks)) {
      if (!configById.has(subBlockId)) continue
      const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockId]
      if (!canonicalId) {
        setField(subBlockId, subBlock.value)
        continue
      }
      if (resolvedGroups.has(canonicalId)) continue
      resolvedGroups.add(canonicalId)
      setField(
        canonicalId,
        resolveActiveCanonicalValue(
          canonicalIndex.groupsById[canonicalId],
          values,
          opts?.canonicalModes
        )
      )
    }

    if (!context.oauthCredential && !resolvedGroups.has('oauthCredential')) {
      const credential = configs.find((config) => config.type === 'oauth-input')
      if (credential) setField('oauthCredential', subBlocks[credential.id]?.value)
    }
    return context
  }

  return buildSelectorRawContext({
    selectorKey: opts.selectorKey,
    blockType,
    subBlocks,
    dependsOn: opts.dependsOn,
    canonicalModes: opts.canonicalModes,
    triggerMode: opts.triggerMode,
    staticContext: opts.staticContext,
  })
}
