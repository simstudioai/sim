import { getBlock } from '@/blocks'
import type { SelectorContext } from '@/hooks/selectors/types'
import type { SubBlockState } from '@/stores/workflows/workflow/types'
import { buildCanonicalIndex } from './visibility'

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
  'fileId',
  'baseId',
  'datasetId',
  'serviceDeskId',
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
  opts?: { workflowId?: string }
): SelectorContext {
  const context: SelectorContext = {}
  if (opts?.workflowId) context.workflowId = opts.workflowId

  const blockConfig = getBlock(blockType)
  if (!blockConfig) return context

  const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)

  for (const [subBlockId, subBlock] of Object.entries(subBlocks)) {
    const val = subBlock?.value
    if (val === null || val === undefined) continue
    const strValue = typeof val === 'string' ? val : String(val)
    if (!strValue) continue

    const canonicalKey = canonicalIndex.canonicalIdBySubBlockId[subBlockId] ?? subBlockId
    if (SELECTOR_CONTEXT_FIELDS.has(canonicalKey as keyof SelectorContext)) {
      context[canonicalKey as keyof SelectorContext] = strValue
    }
  }

  return context
}
