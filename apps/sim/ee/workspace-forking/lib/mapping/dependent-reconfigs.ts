import type { ForkDependentReconfig, ForkResourceUsage } from '@/lib/api/contracts/workspace-fork'
import { coerceObjectArray, isRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import { getWorkflowSearchDependentClears } from '@/lib/workflows/search-replace/dependencies'
import {
  buildSelectorContextFromBlock,
  SELECTOR_CONTEXT_FIELDS,
} from '@/lib/workflows/subblocks/context'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isNonEmptyValue,
  scopeCanonicalModesForTool,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { getDependsOnFields } from '@/blocks/utils'
import type { ForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'
import { toScannerBlocks } from '@/ee/workspace-forking/lib/remap/reference-scan'
import {
  createCanonicalModeGates,
  isSubBlockRequired,
  scanWorkflowReferences,
} from '@/ee/workspace-forking/lib/remap/remap-references'
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
  /** Canonical-mode overrides for resolving the active parent member (undefined -> value heuristic). */
  canonicalModes?: CanonicalModeOverrides
  /** Memoized so the deterministic target block id is derived at most once per block. */
  resolveTargetBlockId: () => string
  /** Map a dependent's config id to its wire `subBlockKey` (identity, or nested `tools[i].id`). */
  makeSubBlockKey: (dependentId: string) => string
  makeTitle: (dependent: SubBlockConfig) => string
  /** Nested `tool-input` tool display name; omitted for top-level block subblocks. */
  toolName?: string
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
    canonicalModes,
    resolveTargetBlockId,
    makeSubBlockKey,
    makeTitle,
    toolName,
    chaining,
    out,
  } = params
  const fullContext = buildSelectorContextFromBlock(contextBlockType, contextSubBlocks)
  const canonicalIndex = buildCanonicalIndex(config.subBlocks)
  const gates = createCanonicalModeGates(config.subBlocks, values, canonicalModes)
  const configById = new Map(config.subBlocks.filter((cfg) => cfg.id).map((cfg) => [cfg.id, cfg]))
  // A field could hang off two anchors (or be reachable via two paths); emit it once.
  const seen = new Set<string>()

  for (const anchor of PARENT_ANCHORS) {
    for (const anchorCfg of config.subBlocks) {
      if (anchorCfg.type !== anchor.subBlockType || !anchorCfg.id) continue
      // An anchor whose canonical pair is in ADVANCED (manual) mode is skipped entirely: the
      // active value is the user-owned manual member's, which is verbatim by policy - a sync
      // never remaps it, so its dependents are never cleared and there is nothing to re-pick.
      if (gates.isAdvancedActiveGroup(anchorCfg.id)) continue
      // Basic mode: the anchor selector's own value. Nested tools can store the pick under the
      // pair's `canonicalParamId` instead (the tool-input UI writes the canonical key), so fall
      // back to it - but only when that key is not itself a subblock id (when it is, the key
      // is the manual member's own field and reading it would leak a manual value).
      let rawValue = values[anchorCfg.id]
      if (
        !isNonEmptyValue(rawValue) &&
        anchorCfg.canonicalParamId &&
        !configById.has(anchorCfg.canonicalParamId)
      ) {
        rawValue = values[anchorCfg.canonicalParamId]
      }
      const parentSourceId = typeof rawValue === 'string' ? rawValue : ''
      if (!parentSourceId) continue
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
        // Skip a DORMANT canonical member: when the dependent's own pair is in advanced
        // (manual) mode, the selector is not the live field - the manual member is, and it
        // is verbatim by policy (never cleared by a remap), so there's nothing to re-pick.
        if (gates.isDormantMember(dependent.id)) continue
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
        // Nested tools can store the pick under the pair's `canonicalParamId` (the tool-input
        // UI writes the canonical key); fall back to it when the key isn't a subblock's own id.
        const rawDependentValue =
          values[dependent.id] ??
          (dependent.canonicalParamId && !configById.has(dependent.canonicalParamId)
            ? values[dependent.canonicalParamId]
            : undefined)
        const rawSourceValue = typeof rawDependentValue === 'string' ? rawDependentValue : ''
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
          ...(toolName ? { toolName } : {}),
          // Source value, so the always-on listing pre-fills a stable parent's selector.
          // The diff route overlays the stored/target-draft value onto `currentValue`;
          // `sourceValue` stays the raw source reference (the copy-resolved parent's seed).
          currentValue: rawSourceValue,
          required: isSubBlockRequired(dependent.required, values),
          providesContextKey,
          consumesContextKeys,
          context: dependentContext,
          sourceValue: rawSourceValue,
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
 * Scans one target `mode` per call: `replace` for targets that exist (re-pick against the
 * swapped parent), `create` for never-synced workflows (pre-configure what the first sync
 * writes - the diff route emits both).
 *
 * `resolveTargetBlockId` MUST be the same resolver `copyWorkflowStateIntoTarget` uses for
 * this promote (see {@link buildForkBlockIdResolver}); otherwise the modal would key a
 * re-pick by a derived id while the sync writes the block under its persisted counterpart,
 * and the override would silently miss.
 */
export function collectForkDependentReconfigs(
  items: ReconfigItem[],
  sourceStates: Map<string, WorkflowState>,
  resolveTargetBlockId: ForkBlockIdResolver,
  /**
   * Which target mode to scan. Defaults to `replace` (the reconfigure UI, where the user re-picks
   * a dependent against a swapped parent). The pre-sync cleared-ref list passes `create` to surface
   * dependents a new target inherits that a remapped parent will clear (it can't be re-picked yet).
   */
  mode: 'create' | 'replace' = 'replace'
): ForkDependentReconfig[] {
  const out: ForkDependentReconfig[] = []
  for (const item of items) {
    if (item.mode !== mode) continue
    const state = sourceStates.get(item.sourceWorkflowId)
    if (!state) continue
    for (const [sourceBlockId, block] of Object.entries(state.blocks)) {
      const config = getBlock(block.type)
      if (!config) continue
      const subBlocks = (block.subBlocks ?? {}) as Record<string, { value?: unknown }>
      const sourceValues = buildSubBlockValues(subBlocks)
      let cachedTargetBlockId: string | null = null
      const resolveBlockId = () =>
        (cachedTargetBlockId ??= resolveTargetBlockId(item.targetWorkflowId, sourceBlockId))

      // Top-level credential/KB/table-anchored selectors. Block-level canonicalModes pick the
      // active parent member; nested tools below pass their tool-scoped overrides (via
      // scopeCanonicalModesForTool), falling back to the value heuristic only when none is set.
      emitAnchoredDependents({
        config,
        values: sourceValues,
        contextBlockType: block.type,
        contextSubBlocks: subBlocks,
        blockName: block.name,
        targetWorkflowId: item.targetWorkflowId,
        canonicalModes: block.data?.canonicalModes,
        resolveTargetBlockId: resolveBlockId,
        makeSubBlockKey: (id) => id,
        makeTitle: (dependent) => dependent.title ?? dependent.id ?? '',
        chaining: true,
        out,
      })

      // Nested `tool-input` tools: each selected tool's own credential-anchored selectors,
      // keyed `toolInput[index].paramId` (matching the needs-config key). Field `title` stays
      // plain; `toolName` carries the tool so the UI can show block → tool → field tiers.
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
            canonicalModes: scopeCanonicalModesForTool(block.data?.canonicalModes, tool.type),
            resolveTargetBlockId: resolveBlockId,
            makeSubBlockKey: (id) => `${toolInputKey}[${toolIndex}].${id}`,
            makeTitle: (dependent) => dependent.title ?? dependent.id ?? '',
            toolName: toolLabel,
            chaining: false,
            out,
          })
        }
      }
    }
  }
  return out
}

interface ResourceUsageItem {
  sourceWorkflowId: string
  targetWorkflowId: string
  mode: 'create' | 'replace'
  /** Source workflow name, shown as the (renamed-aware) target name in the listing. */
  sourceMeta: { name: string }
}

/**
 * Every workflow each mapped resource (any kind) is used in - the spine of the always-on
 * reconfigure listing under a mapping entry. Scans each source workflow's references
 * (deduped per workflow, so a resource used by several blocks is one workflow usage) and
 * groups them by `(kind, sourceId)`. Unlike {@link collectForkDependentReconfigs} this is
 * NOT anchor-limited: it includes resources with no configurable dependent (env vars, files,
 * a Gmail block with no active label) so the modal can still list - greyed - the workflows
 * they appear in. Covers EVERY deployed source workflow - replace targets and creates
 * (never-synced workflows) alike - so the listing accounts for the full next sync.
 */
export function collectForkResourceUsages(
  items: ResourceUsageItem[],
  sourceStates: Map<string, WorkflowState>
): ForkResourceUsage[] {
  const byResource = new Map<string, ForkResourceUsage>()
  for (const item of items) {
    const state = sourceStates.get(item.sourceWorkflowId)
    if (!state) continue
    // scanWorkflowReferences already dedups by `${kind}:${sourceId}` across the workflow,
    // so each resource appears once per workflow here.
    for (const reference of scanWorkflowReferences(toScannerBlocks(state), () => null).references) {
      const key = `${reference.kind}\u0000${reference.sourceId}`
      let usage = byResource.get(key)
      if (!usage) {
        usage = { parentKind: reference.kind, parentSourceId: reference.sourceId, workflows: [] }
        byResource.set(key, usage)
      }
      usage.workflows.push({
        workflowId: item.targetWorkflowId,
        workflowName: item.sourceMeta.name,
      })
    }
  }
  return Array.from(byResource.values())
}
