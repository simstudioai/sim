import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'
import { coerceObjectArray, isRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import { getWorkflowSearchDependentClears } from '@/lib/workflows/search-replace/dependencies'
import {
  buildSelectorContextFromBlock,
  SELECTOR_CONTEXT_FIELDS,
} from '@/lib/workflows/subblocks/context'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  evaluateSubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { deriveForkBlockId } from '@/lib/workspaces/fork/remap/block-identity'
import { isSubBlockRequired } from '@/lib/workspaces/fork/remap/remap-references'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { getDependsOnFields } from '@/blocks/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const isSelectorContextKey = (
  key: string
): key is Parameters<typeof SELECTOR_CONTEXT_FIELDS.has>[0] =>
  SELECTOR_CONTEXT_FIELDS.has(key as Parameters<typeof SELECTOR_CONTEXT_FIELDS.has>[0])

interface ReconfigItem {
  sourceWorkflowId: string
  targetWorkflowId: string
  mode: 'create' | 'replace'
}

/**
 * Parent anchor types a dependent selector can hang off, with the SelectorContext key
 * the new parent value is supplied under. A parent is a remappable resource (rewritten
 * source->target on sync) whose target swap clears its dependents. MCP servers are
 * intentionally excluded: their tool dependent has no `selectorKey` and a separate
 * (non-`useSelectorOptions`) stack, so it falls back to the needs-config surfacing.
 */
const PARENT_ANCHORS: ReadonlyArray<{
  subBlockType: string
  parentKind: ForkDependentReconfig['parentKind']
  parentContextKey: string
}> = [
  { subBlockType: 'oauth-input', parentKind: 'credential', parentContextKey: 'oauthCredential' },
  {
    subBlockType: 'knowledge-base-selector',
    parentKind: 'knowledge-base',
    parentContextKey: 'knowledgeBaseId',
  },
  { subBlockType: 'table-selector', parentKind: 'table', parentContextKey: 'tableId' },
]

interface EmitAnchoredParams {
  /** The block (top-level) or tool config whose subblocks are scanned for anchors. */
  config: NonNullable<ReturnType<typeof getBlock>>
  /** Flat id -> value map for that config (top-level subblock values, or a tool's params). */
  values: Record<string, unknown>
  /** Block/tool type + its subblock shape, for building the source selector context. */
  contextBlockType: string
  contextSubBlocks: Record<string, { value?: unknown }>
  blockName: string
  targetWorkflowId: string
  /** Memoized so the deterministic target block id is derived at most once per block. */
  resolveTargetBlockId: () => string
  /** Map a dependent's config id to its wire `subBlockKey` (identity, or nested `tools[i].id`). */
  makeSubBlockKey: (dependentId: string) => string
  makeTitle: (dependent: SubBlockConfig) => string
  /**
   * Emit `providesContextKey`/`consumesContextKeys` so the modal can chain in-block
   * re-picks. Top-level chains; nested tool params don't (a tool's chain would need
   * per-tool context scoping - out of scope - and the common nested case is a single
   * credential-anchored field).
   */
  chaining: boolean
  out: ForkDependentReconfig[]
}

/**
 * Emit one config's credential/KB/table-anchored selector dependents that the source had
 * configured. Shared by the top-level subblock scan and the nested `tool-input` tool scan.
 * Walks the FULL transitive dependent chain (parent -> child -> grandchild) per anchor and
 * dedups fields reachable via multiple anchors/paths.
 */
function emitAnchoredDependents(params: EmitAnchoredParams): void {
  const {
    config,
    values,
    contextBlockType,
    contextSubBlocks,
    blockName,
    targetWorkflowId,
    resolveTargetBlockId,
    makeSubBlockKey,
    makeTitle,
    chaining,
    out,
  } = params
  const fullContext = buildSelectorContextFromBlock(contextBlockType, contextSubBlocks)
  const canonicalIndex = buildCanonicalIndex(config.subBlocks)
  const configById = new Map(config.subBlocks.filter((cfg) => cfg.id).map((cfg) => [cfg.id, cfg]))
  // A field could hang off two anchors (or be reachable via two paths); emit it once.
  const seen = new Set<string>()

  for (const anchor of PARENT_ANCHORS) {
    for (const anchorCfg of config.subBlocks) {
      if (anchorCfg.type !== anchor.subBlockType || !anchorCfg.id) continue
      const rawValue = values[anchorCfg.id]
      const parentSourceId = typeof rawValue === 'string' ? rawValue : ''
      // Skip empty and org-scoped credential sets (those carry over unchanged).
      if (!parentSourceId || parentSourceId.startsWith('credentialSet:')) continue
      // Multi-value parents (comma-joined) can't match a single mapping entry; skip
      // (the field falls back to needs-config) rather than mis-bind to one of several.
      if (parentSourceId.includes(',')) continue

      // Context the dependents need (spreadsheetId, ...) minus the parent key the modal supplies.
      const context: Record<string, string> = {}
      for (const [key, value] of Object.entries(fullContext)) {
        if (key === anchor.parentContextKey) continue
        if (typeof value === 'string' && value) context[key] = value
      }

      for (const clear of getWorkflowSearchDependentClears(config.subBlocks, anchorCfg.id)) {
        const dependent = configById.get(clear.subBlockId)
        if (!dependent?.id || !dependent.selectorKey) continue
        // Skip fields gated off by their `condition` - a selector under a now-inactive
        // operation (e.g. a move-only label while the block reads) isn't in play. We do
        // NOT require a source value: an active selector the source left empty is still
        // offered, so the user can set a label/sheet during the swap even when the source
        // (or a prior sync) cleared it - the whole point of the in-place re-pick.
        if (dependent.condition && !evaluateSubBlockCondition(dependent.condition, values)) continue
        // The SelectorContext key this field supplies to its own descendants, so the
        // modal can chain re-picks (re-picked spreadsheet feeds the sheet selector).
        const canonicalKey = canonicalIndex.canonicalIdBySubBlockId[dependent.id] ?? dependent.id
        // Dedup by canonical key so a basic/advanced pair (or two paths to the same field)
        // is offered exactly once.
        if (seen.has(canonicalKey)) continue
        seen.add(canonicalKey)
        const providesContextKey =
          chaining && isSelectorContextKey(canonicalKey) ? canonicalKey : undefined
        // The SelectorContext keys this field needs from in-block siblings (e.g. a sheet
        // needs the spreadsheet), excluding the anchor key the modal already supplies, so
        // the modal can keep a child disabled until its re-picked parent is chosen.
        const consumesContextKeys = chaining
          ? [
              ...new Set(
                getDependsOnFields(dependent.dependsOn)
                  .map((parent) => canonicalIndex.canonicalIdBySubBlockId[parent] ?? parent)
                  .filter((key) => key !== anchor.parentContextKey && isSelectorContextKey(key))
              ),
            ]
          : []
        // Carry the selector's static `mimeType` filter (Drive/Sheets pickers) so the
        // modal selector loads the same filtered list the editor would, not all files.
        const dependentContext =
          typeof dependent.mimeType === 'string' && dependent.mimeType
            ? { ...context, mimeType: dependent.mimeType }
            : context
        out.push({
          parentKind: anchor.parentKind,
          parentSourceId,
          parentContextKey: anchor.parentContextKey,
          targetWorkflowId,
          targetBlockId: resolveTargetBlockId(),
          blockName,
          subBlockKey: makeSubBlockKey(dependent.id),
          selectorKey: dependent.selectorKey,
          title: makeTitle(dependent),
          required: isSubBlockRequired(dependent.required, values),
          providesContextKey,
          consumesContextKeys,
          context: dependentContext,
        })
      }
    }
  }
}

/**
 * Scan the source's deployed workflows for configured selector fields that `dependsOn`
 * a remappable parent (a credential, knowledge base, or table) - the fields a sync clears
 * whenever that parent's target changes. Covers top-level block subblocks AND selectors
 * nested inside `tool-input` tools (Agent/tool blocks), so a Gmail tool's label inside an
 * Agent block is offered for re-pick too. Each entry carries the deterministic target
 * block id, the parent it hangs off (so the modal can bind it to the newly-chosen target),
 * and the source-derived selector context. Every selector active for the source's current
 * operation is emitted - including ones the source left empty - so the user can set a
 * value in place during the swap even when the source (or a prior sync) had none; only
 * selectors gated off by their `condition` (a different operation's variant) are skipped.
 * Replace targets only: a freshly created target has nothing configured to swap yet.
 */
export function collectForkDependentReconfigs(
  items: ReconfigItem[],
  sourceStates: Map<string, WorkflowState>
): ForkDependentReconfig[] {
  const out: ForkDependentReconfig[] = []
  for (const item of items) {
    if (item.mode !== 'replace') continue
    const state = sourceStates.get(item.sourceWorkflowId)
    if (!state) continue
    for (const [sourceBlockId, block] of Object.entries(state.blocks)) {
      const config = getBlock(block.type)
      if (!config) continue
      const subBlocks = (block.subBlocks ?? {}) as Record<string, { value?: unknown }>
      const sourceValues = buildSubBlockValues(subBlocks)
      let targetBlockId: string | null = null
      const resolveTargetBlockId = () =>
        (targetBlockId ??= deriveForkBlockId(item.targetWorkflowId, sourceBlockId))

      // Top-level credential/KB/table-anchored selectors.
      emitAnchoredDependents({
        config,
        values: sourceValues,
        contextBlockType: block.type,
        contextSubBlocks: subBlocks,
        blockName: block.name,
        targetWorkflowId: item.targetWorkflowId,
        resolveTargetBlockId,
        makeSubBlockKey: (id) => id,
        makeTitle: (dependent) => dependent.title ?? dependent.id ?? '',
        chaining: true,
        out,
      })

      // Nested `tool-input` tools: each selected tool's own credential-anchored selectors,
      // keyed `toolInput[index].paramId` (matching the needs-config key) and titled with the
      // tool so the modal re-picks them under the same block card.
      for (const cfg of config.subBlocks) {
        if (cfg.type !== 'tool-input' || !cfg.id) continue
        const { array: tools } = coerceObjectArray(subBlocks[cfg.id]?.value)
        if (!tools) continue
        for (let index = 0; index < tools.length; index++) {
          const tool = tools[index]
          if (!isRecord(tool) || typeof tool.type !== 'string') continue
          const toolConfig = getBlock(tool.type)
          if (!toolConfig) continue
          const toolParams = isRecord(tool.params) ? tool.params : {}
          // A tool's `operation` is stored at the tool level, not in params, but subblock
          // conditions reference it (e.g. a Gmail label only under `read_gmail`). Merge it
          // in so condition-gating matches the editor's `{ operation, ...params }`.
          const toolValues =
            typeof tool.operation === 'string'
              ? { operation: tool.operation, ...toolParams }
              : toolParams
          const toolContextSubBlocks: Record<string, { value?: unknown }> = {}
          for (const [key, value] of Object.entries(toolValues)) {
            toolContextSubBlocks[key] = { value }
          }
          const toolLabel =
            typeof tool.title === 'string' && tool.title ? tool.title : toolConfig.name
          const toolInputKey = cfg.id
          const toolIndex = index
          emitAnchoredDependents({
            config: toolConfig,
            values: toolValues,
            contextBlockType: tool.type,
            contextSubBlocks: toolContextSubBlocks,
            blockName: block.name,
            targetWorkflowId: item.targetWorkflowId,
            resolveTargetBlockId,
            makeSubBlockKey: (id) => `${toolInputKey}[${toolIndex}].${id}`,
            makeTitle: (dependent) => `${toolLabel}: ${dependent.title ?? dependent.id ?? ''}`,
            chaining: false,
            out,
          })
        }
      }
    }
  }
  return out
}
