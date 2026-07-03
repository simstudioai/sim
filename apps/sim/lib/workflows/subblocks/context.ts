import { getBlock } from '@/blocks'
import type { SelectorContext } from '@/hooks/selectors/types'
import type { SubBlockState } from '@/stores/workflows/workflow/types'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  type CanonicalModeOverrides,
  resolveActiveCanonicalValue,
} from './visibility'

/**
 * Canonical param IDs (or raw subblock IDs) that correspond to SelectorContext fields.
 * A subblock's resolved canonical key is set on the context only if it appears here.
 */
export const SELECTOR_CONTEXT_FIELDS = new Set<keyof SelectorContext>([
  'oauthCredential',
  'domain',
  'teamId',
  'projectId',
  'knowledgeBaseId',
  'planId',
  'siteId',
  'collectionId',
  'spreadsheetId',
  'driveId',
  'fileId',
  'baseId',
  'datasetId',
  'serviceDeskId',
  'impersonateUserEmail',
  'boardId',
  'awsAccessKeyId',
  'awsSecretAccessKey',
  'awsRegion',
  'logGroupName',
  'tableId',
])

/**
 * Builds a SelectorContext from a block's subBlocks using the canonical index.
 *
 * Iterates all subblocks, resolves each through canonicalIdBySubBlockId to get
 * the canonical key, then checks it against SELECTOR_CONTEXT_FIELDS.
 * This avoids hardcoding subblock IDs and automatically handles basic/advanced
 * renames.
 */
export function buildSelectorContextFromBlock(
  blockType: string,
  subBlocks: Record<string, SubBlockState | { value?: unknown }>,
  opts?: { workflowId?: string; workspaceId?: string; canonicalModes?: CanonicalModeOverrides }
): SelectorContext {
  const context: SelectorContext = {}
  if (opts?.workflowId) context.workflowId = opts.workflowId
  if (opts?.workspaceId) context.workspaceId = opts.workspaceId

  const blockConfig = getBlock(blockType)
  if (!blockConfig) return context

  const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
  const values = buildSubBlockValues(subBlocks)
  const resolvedGroups = new Set<string>()

  const setField = (key: string, value: unknown) => {
    if (value === null || value === undefined) return
    const strValue = typeof value === 'string' ? value : String(value)
    if (!strValue) return
    if (SELECTOR_CONTEXT_FIELDS.has(key as keyof SelectorContext)) {
      context[key as keyof SelectorContext] = strValue
    }
  }

  for (const [subBlockId, subBlock] of Object.entries(subBlocks)) {
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockId]
    if (canonicalId) {
      // A canonical group resolves to its ACTIVE member only (no last-write-wins between a
      // basic/advanced pair when both hold values), honoring an explicit mode override.
      if (resolvedGroups.has(canonicalId)) continue
      resolvedGroups.add(canonicalId)
      const group = canonicalIndex.groupsById[canonicalId]
      setField(canonicalId, resolveActiveCanonicalValue(group, values, opts?.canonicalModes))
      continue
    }
    setField(subBlockId, subBlock?.value)
  }

  return context
}
