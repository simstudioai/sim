import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import type { SubBlockType } from '@sim/workflow-types/blocks'
import type { z } from 'zod'
import type { forkRemapKindSchema } from '@/lib/api/contracts/workspace-fork'
import { createMcpToolId } from '@/lib/mcp/shared'
import {
  coerceObjectArray,
  isRecord,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import { CREDENTIAL_SUBBLOCK_IDS } from '@/lib/workflows/persistence/utils'
import { getWorkflowSearchDependentClears } from '@/lib/workflows/search-replace/dependencies'
import { getToolInputParamConfigs } from '@/lib/workflows/search-replace/indexer'
import {
  getWorkflowSearchSubBlockResourceDefinition,
  parseWorkflowSearchSubBlockResources,
  type StructuredWorkflowSearchResourceKind,
} from '@/lib/workflows/search-replace/resources/registry'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isCanonicalPair,
  isNonEmptyValue,
  reindexCanonicalModesByPosition,
  resolveActiveCanonicalValue,
  resolveCanonicalMode,
  scopeCanonicalModesForTool,
} from '@/lib/workflows/subblocks/visibility'
import type { ParsedStoredTool } from '@/lib/workflows/tool-input/types'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { getDependsOnFields, getSubBlocksDependingOnChange } from '@/blocks/utils'
import {
  collectForkFileUploadKeys,
  remapForkFileUploadValue,
} from '@/ee/workspace-forking/lib/remap/remap-files'
import { isEnvVarReference, isReference } from '@/executor/constants'

/**
 * Resource kinds the fork remapper rewrites across workspaces, derived from the
 * wire contract so the union can't drift from `forkRemapKindSchema`. `workflow`,
 * `mcp-tool`, and the service-specific `selector-resource` kinds are deliberately
 * excluded: workflow references are remapped via the workflow identity map, and
 * MCP tool / selector ids are not workspace-local so they carry over unchanged.
 */
export type ForkRemapKind = z.infer<typeof forkRemapKindSchema>

const logger = createLogger('WorkspaceForkRemapReferences')

/**
 * Reference kinds whose absence BLOCKS a sync (they gate `requiredComplete` and are resolved by
 * mapping), as opposed to optional kinds that silently clear. Exported so the cleared-ref preview
 * can exclude them - a required ref is a blocker, never a silent "will be cleared" item.
 */
export const REQUIRED_KINDS = new Set<ForkRemapKind>(['credential', 'env-var'])

/**
 * Id-based override kind for a TOOL param's credential, resolved by subblock id so a
 * basic `credential` / `triggerCredentials` is caught even when its config is filtered
 * out by a reactive condition (the registry path would otherwise skip it). Advanced
 * `manual*` ids are an escape hatch - the user owns them (e.g. via a `{{SECRET}}`), so
 * they are never auto-remapped.
 */
function getToolParamOverrideKind(paramId: string): ForkRemapKind | null {
  const base = paramId.replace(/_\d+$/, '')
  if (base === 'manualCredential') return null
  if (CREDENTIAL_SUBBLOCK_IDS.has(base)) return 'credential'
  return null
}

export const REGISTRY_KIND_TO_FORK_KIND: Partial<
  Record<StructuredWorkflowSearchResourceKind, ForkRemapKind>
> = {
  'oauth-credential': 'credential',
  'knowledge-base': 'knowledge-base',
  'knowledge-document': 'knowledge-document',
  table: 'table',
  'mcp-server': 'mcp-server',
}
// `file` is intentionally excluded from the generic registry path: `file-upload`
// (workspace files) is remapped by storage key via `remapForkFileUploadValue`, and
// `file-selector` (external provider file ids, credential-scoped) carries over
// unchanged. `document-selector` (`knowledge-document`) IS remapped through the doc-id
// map when its referenced document was copied into the fork; an unmapped document (its
// parent KB wasn't copied, or the doc wasn't copyable) resolves to null and is cleared,
// and `clearDependentsOnRemap` still clears it as a `knowledgeBaseId` dependent when the
// parent KB itself is unmapped. `mcp-tool-selector` follows its `mcp-server-selector`
// parent's remap: mapping asserts the servers are equivalent, so the tool SELECTION is
// kept (its embedded server id swapped to the target's, the tool name verbatim - see
// {@link remapForkSubBlocks}) and `clearDependentsOnRemap` exempts it. When the server
// is CLEARED (unmapped / fork-create) the tool still clears as a dependent.

/**
 * Dependent subblock types whose values are name/slot-based rather than id-based, so they stay
 * valid on a COPIED parent (tag definitions are copied verbatim - same names, same slots) and on a
 * MAPPED parent (mapping asserts the resources are equivalent). The dependent-clear passes preserve
 * these when their parent was remapped to a non-empty target; a CLEARED parent still clears them.
 */
const PRESERVED_NAME_BASED_DEPENDENT_TYPES = new Set<string>([
  'knowledge-tag-filters',
  'document-tag-entry',
])

/**
 * Dependent subblock types preserved ONLY when their parent was remapped via a COPY: a copied
 * table duplicates its schema verbatim (identical column ids), so a column selection stays valid
 * on the copy - while a MAPPED (different) table has its own column ids, so the value clears and
 * the reconfigure flow offers a re-pick. Matches how filter/sort builders (no `dependsOn`) already
 * carry over on a copy.
 */
const PRESERVED_UNDER_COPY_DEPENDENT_TYPES = new Set<string>(['column-selector'])

/** Matches `{{ENV_KEY}}` references inside subblock values; shared with cascade detection. */
export const ENV_REF_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/**
 * Rewrite `{{ENV}}` references in free text (a copied custom tool's `code`, an MCP url/header)
 * through an env-name resolver, so a promote that renames an env var (e.g. SLACK_API_KEY ->
 * SLACK_API_KEY_TEST) keeps the copied text pointing at the right key. A key the resolver leaves
 * unmapped (null/undefined) or maps to the same name is kept verbatim - a graceful no-op so an env
 * that exists under the same name in the target still works. Pure; mirrors {@link remapEnvInValue}'s
 * preserve-by-name policy for the string case.
 */
export function rewriteEnvRefsInText(
  text: string,
  resolveEnvName: (key: string) => string | null | undefined
): string {
  if (!text) return text
  return text.replace(ENV_REF_PATTERN, (full, key: string) => {
    const target = resolveEnvName(key)
    return target && target !== key ? `{{${target}}}` : full
  })
}

/**
 * Resolves a source-workspace resource id (or env key, for `env-var`) to its
 * mapped target id. Returns the target id (which may equal the source for env
 * keys that exist under the same name), or null/undefined when there is no
 * mapping — which surfaces the reference as unmapped.
 */
export type ForkReferenceResolver = (
  kind: ForkRemapKind,
  sourceId: string
) => string | null | undefined

/** Identity metadata of a mapped TARGET MCP server row (url is null for url-less transports). */
export interface ForkMcpServerMeta {
  name: string
  url: string | null
}

/**
 * Resolves a mapped TARGET MCP server id to its row metadata, so a remapped tool-input
 * entry's embedded `serverUrl`/`serverName` are rewritten from the target server instead
 * of carrying the source server's (which would show a false "URL changed" stale badge in
 * the target UI). Undefined when the row is unknown - the entry's metadata is then left
 * as-is. Threaded by promote (which batch-loads the mapped targets); scan-only callers
 * omit it because they never persist the remapped value.
 */
export type ForkMcpServerMetaResolver = (targetServerId: string) => ForkMcpServerMeta | undefined

export interface ForkReference {
  kind: ForkRemapKind
  sourceId: string
  blockId?: string
  blockName?: string
  subBlockKey: string
  required: boolean
}

export interface RemapSubBlocksResult {
  subBlocks: SubBlockRecord
  references: ForkReference[]
  unmapped: ForkReference[]
  /** Subblock keys whose resource id was rewritten/cleared this pass (the `dependsOn` parents). */
  remappedKeys: Set<string>
  /**
   * The subset of {@link remappedKeys} whose new target is a COPY of the source resource
   * (per the caller's `isCopiedTarget`), so copy-faithful dependents (a copied table's column
   * selection) can be preserved instead of cleared. Empty when no provenance was supplied.
   */
  copyRemappedKeys: Set<string>
  /**
   * The block's `canonicalModes`, reindexed to match the shifted array positions when a nested
   * `tool-input` subblock dropped an unresolved custom-tool/MCP entry (see
   * {@link reindexCanonicalModesByPosition}). `undefined` when nothing needed to change - the
   * caller should keep the block's existing `canonicalModes` in that case.
   */
  canonicalModes?: CanonicalModeOverrides
}

/**
 * A `copyWorkflowStateIntoTarget` subBlock transform. Returns the rewritten subBlocks (unchanged
 * shape, for backward compatibility with existing callers/tests); a nested `tool-input` reindex
 * (see {@link RemapSubBlocksResult.canonicalModes}) is surfaced separately via the optional
 * `onCanonicalModesChanged` callback rather than the return value, so a caller that doesn't
 * persist `canonicalModes` (most don't need to) can ignore it entirely.
 */
export type SubBlockTransform = (
  subBlocks: SubBlockRecord,
  blockType: string,
  canonicalModes?: CanonicalModeOverrides,
  onCanonicalModesChanged?: (next: CanonicalModeOverrides) => void
) => SubBlockRecord

/**
 * The canonical-pair mode questions every fork/promote surface asks of a subblock key.
 * A pair is two SUBBLOCKS with different ids sharing one `canonicalParamId`; the block's
 * `canonicalModes[canonicalId]` (falling back to the value heuristic) picks the ACTIVE member.
 * The policy the gates encode: only the active member is real - an active basic selector is
 * remapped and requires mapping, an active advanced (manual) member and its dependents pass
 * through verbatim, and a dormant member's value is cleared and never detected.
 */
export interface CanonicalModeGates {
  /** The key is a pair member that is NOT the pair's active member. */
  isDormantMember: (subBlockKey: string) => boolean
  /** The key is the pair's ACTIVE advanced member - the live, user-owned manual field. */
  isActiveManualMember: (subBlockKey: string) => boolean
  /** A direct `dependsOn` parent of this key is a pair in advanced (manual) mode. */
  isManualParentDependent: (subBlockKey: string) => boolean
  /** The pair containing (or named by) this id resolves to advanced (manual) mode. */
  isAdvancedActiveGroup: (memberOrCanonicalId: string) => boolean
  /** The key's `condition` evaluates false against the serializer's params view. */
  isConditionHidden: (subBlockKey: string) => boolean
}

const NO_GATES: CanonicalModeGates = {
  isDormantMember: () => false,
  isActiveManualMember: () => false,
  isManualParentDependent: () => false,
  isAdvancedActiveGroup: () => false,
  isConditionHidden: () => false,
}

/**
 * Build the {@link CanonicalModeGates} for one block (or nested tool) from its subblock configs
 * and a flat id -> value map (top-level subblock values, or a tool's params). One canonical
 * index and one mode resolution feed every gate, so all surfaces answer identically. Mode
 * resolution uses the RAW values (member ids only); condition evaluation uses a separate view
 * augmented with each pair's ACTIVE value under its canonical id, mirroring how the serializer
 * exposes params to conditions. With no configs (unknown block type) every gate is a no-op:
 * everything is detected and nothing passes through, the conservative default.
 */
export function createCanonicalModeGates(
  configSubBlocks: SubBlockConfig[] | undefined,
  values: Record<string, unknown>,
  canonicalModes?: CanonicalModeOverrides
): CanonicalModeGates {
  if (!configSubBlocks || configSubBlocks.length === 0) return NO_GATES
  const canonicalIndex = buildCanonicalIndex(configSubBlocks)
  const configByBaseKey = new Map(
    configSubBlocks.filter((cfg) => cfg.id).map((cfg) => [cfg.id, cfg])
  )
  const conditionValues = { ...values }
  for (const [canonicalId, group] of Object.entries(canonicalIndex.groupsById)) {
    if (conditionValues[canonicalId] === undefined) {
      conditionValues[canonicalId] = resolveActiveCanonicalValue(group, values, canonicalModes)
    }
  }

  const groupFor = (memberOrCanonicalId: string) => {
    const canonicalId =
      canonicalIndex.canonicalIdBySubBlockId[memberOrCanonicalId] ?? memberOrCanonicalId
    const group = canonicalIndex.groupsById[canonicalId]
    return group && isCanonicalPair(group) ? group : undefined
  }
  const baseKeyOf = (subBlockKey: string) => subBlockKey.replace(/_\d+$/, '')

  const isAdvancedActiveGroup = (memberOrCanonicalId: string): boolean => {
    const group = groupFor(memberOrCanonicalId)
    if (!group) return false
    return resolveCanonicalMode(group, values, canonicalModes) === 'advanced'
  }

  return {
    isDormantMember: (subBlockKey) => {
      const baseKey = baseKeyOf(subBlockKey)
      const group = groupFor(baseKey)
      if (!group || !canonicalIndex.canonicalIdBySubBlockId[baseKey]) return false
      return isAdvancedActiveGroup(baseKey) !== group.advancedIds.includes(baseKey)
    },
    isActiveManualMember: (subBlockKey) => {
      const baseKey = baseKeyOf(subBlockKey)
      const group = groupFor(baseKey)
      if (!group || !group.advancedIds.includes(baseKey)) return false
      return isAdvancedActiveGroup(baseKey)
    },
    isManualParentDependent: (subBlockKey) => {
      const cfg = configByBaseKey.get(baseKeyOf(subBlockKey))
      if (!cfg?.dependsOn) return false
      return getDependsOnFields(cfg.dependsOn).some((parent) => isAdvancedActiveGroup(parent))
    },
    isAdvancedActiveGroup,
    isConditionHidden: (subBlockKey) => {
      const cfg = configByBaseKey.get(baseKeyOf(subBlockKey))
      if (!cfg?.condition) return false
      return !evaluateSubBlockCondition(
        cfg.condition as Parameters<typeof evaluateSubBlockCondition>[0],
        conditionValues
      )
    },
  }
}

/** Per-block context for the fork remap. `blockType`/`canonicalModes` gate DETECTION (not rewrite). */
export interface RemapForkContext {
  blockId?: string
  blockName?: string
  /** Block type, to build the canonical index for active-member DETECTION gating (rewrite unaffected). */
  blockType?: string
  /** Canonical-mode overrides (`block.data.canonicalModes`), picking the active member per pair. */
  canonicalModes?: CanonicalModeOverrides
  /** Target MCP server row lookup for rewriting remapped tool-input entries' server metadata. */
  resolveMcpServerMeta?: ForkMcpServerMetaResolver
  /**
   * Whether a resolved (kind, sourceId) target is a COPY of the source (fork-create: always;
   * promote: the copy-selection overlay). Feeds `copyRemappedKeys` so copy-faithful dependents
   * (a copied table's column selection) survive the dependent-clear pass.
   */
  isCopiedTarget?: (kind: ForkRemapKind, sourceId: string) => boolean
}

function remapEnvInValue(
  value: unknown,
  resolve: ForkReferenceResolver,
  record: (sourceId: string, mapped: boolean) => void
): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_REF_PATTERN, (full, key: string) => {
      const target = resolve('env-var', key)
      if (target == null) {
        record(key, false)
        return full
      }
      record(key, true)
      return `{{${target}}}`
    })
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapEnvInValue(item, resolve, record))
  }
  // Recurse plain objects so `{{ENV}}` nested in array-form tool params (and other
  // object-valued subblocks) is rewritten, not just top-level strings/arrays.
  if (isRecord(value)) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      const remapped = remapEnvInValue(nested, resolve, record)
      if (remapped !== nested) changed = true
      next[key] = remapped
    }
    return changed ? next : value
  }
  return value
}

interface ToolBlockRemapOptions {
  resolve: ForkReferenceResolver
  /** Resolve a copied file storage key; null when the file was not copied. */
  resolveFileKey: (sourceKey: string) => string | null
  /** Record a detected reference so it surfaces in the mapping UI / cascade. */
  record?: (kind: ForkRemapKind, sourceId: string, mapped: boolean) => void
  /** Fork-create clears unresolved copyable refs; promote keeps them (surfaced as unmapped). */
  clearUnresolved: boolean
  /** Injected block configs (production falls back to the block registry). */
  blockConfigs?: Parameters<typeof getToolInputParamConfigs>[0]['blockConfigs']
  /** Copy provenance for a resolved target (see {@link RemapForkContext.isCopiedTarget}). */
  isCopiedTarget?: (kind: ForkRemapKind, sourceId: string) => boolean
  /**
   * The owning BLOCK's `data.canonicalModes` (keys scoped `${toolIndex}:${canonicalId}` for
   * nested tools - by the tool's position in its tool-input array, not its type, so two tools
   * of the same type don't share an override), so the active canonical member per pair matches
   * the tool-input UI.
   */
  parentCanonicalModes?: CanonicalModeOverrides
  /** This tool's position in its parent's `tool-input` array - see {@link parentCanonicalModes}. */
  toolIndex?: number
}

/**
 * Rewrite the workspace-scoped resource ids nested inside a block tool's `params`
 * (credentials, KBs, tables, files, MCP servers). Param→subBlock-config resolution
 * reuses `getToolInputParamConfigs` so it matches exactly what the editor/search
 * index sees. Custom-tool / MCP / workflow_input tools carry their ids in dedicated
 * fields (handled by the callers / the workflow id map), not block params, so they
 * pass through here untouched. Returns a new tool object only when something changed.
 * After remapping, dependent params (via `dependsOn`) of any changed resource are
 * cleared with the same {@link getWorkflowSearchDependentClears} walk search-replace
 * uses, so a child scoped to the old parent isn't left stale.
 */
export function remapToolBlockResources(
  tool: Record<string, unknown>,
  opts: ToolBlockRemapOptions
): Record<string, unknown> {
  if (typeof tool.type !== 'string') return tool
  const params = tool.params
  if (!isRecord(params)) return tool

  let nextParams: Record<string, unknown> | null = null
  const setParam = (paramId: string, value: unknown) => {
    nextParams ??= { ...params }
    nextParams[paramId] = value
  }
  const remappedParamIds = new Set<string>()

  // Mode policy for the tool's canonical pairs, mirroring the top-level pass: only the ACTIVE
  // member matters. A DORMANT member key is cleared outright (no record, no dependent clearing);
  // an ACTIVE MANUAL parent passes its dependents through verbatim. Modes resolve exactly as the
  // tool-input UI does: the block-level overrides scoped to this tool, then the value heuristic.
  const toolValues: Record<string, unknown> =
    typeof tool.operation === 'string' ? { operation: tool.operation, ...params } : { ...params }
  const scopedModes = scopeCanonicalModesForTool(
    opts.parentCanonicalModes,
    opts.toolIndex,
    tool.type
  )
  const toolBlockSubBlocks = (opts.blockConfigs?.[tool.type] ?? getBlock(tool.type))?.subBlocks
  const gates = createCanonicalModeGates(toolBlockSubBlocks, toolValues, scopedModes)

  // Clear DORMANT member keys first: a stale inactive value must not survive the copy (and must
  // never be recorded). Not a dependent-clear seed - the pair's ACTIVE member carries the live
  // value, and only ITS remap clears dependents.
  for (const paramKey of Object.keys(params)) {
    if (!gates.isDormantMember(paramKey)) continue
    const currentValue = params[paramKey]
    if (currentValue == null || currentValue === '') continue
    setParam(paramKey, '')
  }

  // Id-keyed resource params (credential / triggerCredentials overrides): walked from the raw
  // params so they're caught even when their config is filtered out by a reactive condition
  // (the registry loop below would otherwise miss them). Dormant members were cleared above.
  for (const paramId of Object.keys(params)) {
    const overrideKind = getToolParamOverrideKind(paramId)
    if (!overrideKind) continue
    if (gates.isDormantMember(paramId)) continue
    const currentValue = params[paramId]
    if (typeof currentValue !== 'string' || !currentValue) continue
    const target = opts.resolve(overrideKind, currentValue)
    opts.record?.(overrideKind, currentValue, target != null)
    if (target != null) {
      if (target !== currentValue) {
        setParam(paramId, target)
        remappedParamIds.add(paramId)
      }
    } else if (opts.clearUnresolved) {
      setParam(paramId, '')
      remappedParamIds.add(paramId)
    }
  }

  const toolView: ParsedStoredTool = {
    type: tool.type,
    operation: typeof tool.operation === 'string' ? tool.operation : undefined,
    toolId: typeof tool.toolId === 'string' ? tool.toolId : undefined,
    customToolId: typeof tool.customToolId === 'string' ? tool.customToolId : undefined,
    params,
  }
  let configs: ReturnType<typeof getToolInputParamConfigs>
  try {
    configs = getToolInputParamConfigs({
      tool: toolView,
      toolIndex: opts.toolIndex,
      parentCanonicalModes: opts.parentCanonicalModes,
      blockConfigs: opts.blockConfigs,
    })
  } catch (error) {
    // Unknown block / resolver failure: don't crash the fork/promote, but log so a
    // real bug isn't masked. Nested resource ids in this tool stay as-is.
    logger.warn('Could not resolve tool params for fork remap', {
      toolType: tool.type,
      error: getErrorMessage(error),
    })
    return nextParams ? { ...tool, params: nextParams } : tool
  }

  // Subblock ids whose value changed, seeding the dependent-clear walk below (the walk runs on
  // subblock ids; `remappedParamIds` tracks the PARAM KEYS written, which for a canonical pair
  // can be the `canonicalParamId` rather than the subblock id).
  const remappedSubBlockIds = new Set<string>(remappedParamIds)
  /** Subblock ids remapped via a COPY, so copy-faithful dependents (column picks) survive. */
  const copyRemappedSubBlockIds = new Set<string>()

  for (const { paramId, config } of configs) {
    if (getToolParamOverrideKind(paramId)) continue
    const definition = getWorkflowSearchSubBlockResourceDefinition(config)
    if (!definition) continue
    // Belt-and-braces: the params helper already returns only each pair's ACTIVE member, but a
    // dormant member slipping through must never remap - in advanced mode the shared
    // `canonicalParamId` params key holds the user-owned manual value.
    if (gates.isDormantMember(paramId)) continue
    // A dependent scoped to an ACTIVE MANUAL parent rides the manual value - the parent is
    // user-owned and never remapped, so the dependent passes through verbatim too.
    if (gates.isManualParentDependent(paramId)) continue
    // A stored tool's params key resources by the subblock id OR by the pair's
    // `canonicalParamId` (the tool-input UI writes the canonical key) - and legacy rows can
    // carry both. Remap every present key so no alias keeps a stale source id.
    const paramKeys = [paramId, config.canonicalParamId].filter(
      (key): key is string => typeof key === 'string' && key.length > 0
    )

    for (const paramKey of new Set(paramKeys)) {
      const currentValue = (nextParams ?? params)[paramKey]
      if (currentValue == null) continue

      if (definition.kind === 'file') {
        // file-upload (workspace file) remaps by storage key; file-selector (external
        // provider id) carries over unchanged. Each key is recorded as a `file` reference so
        // a nested tool's workspace file surfaces in the scan / unmapped set and can be copied.
        if (config.type !== 'file-upload') continue
        for (const fileKey of collectForkFileUploadKeys(currentValue)) {
          opts.record?.('file', fileKey, opts.resolveFileKey(fileKey) != null)
        }
        const remapped = remapForkFileUploadValue(currentValue, opts.resolveFileKey)
        if (remapped !== currentValue) {
          setParam(paramKey, remapped)
          remappedParamIds.add(paramKey)
          remappedSubBlockIds.add(paramId)
        }
        continue
      }

      const forkKind = REGISTRY_KIND_TO_FORK_KIND[definition.kind]
      if (!forkKind) continue

      const refs = parseWorkflowSearchSubBlockResources(currentValue, config)
      if (refs.length === 0) continue

      let value: unknown = currentValue
      const seen = new Set<string>()
      for (const ref of refs) {
        if (seen.has(ref.rawValue)) continue
        seen.add(ref.rawValue)
        // A canonical param key is also the advanced (manual) member's write target, so it can
        // hold user-owned references (`<start.x>` / `{{ENV}}`). Those are never workspace ids:
        // keep them verbatim (the manual escape hatch), don't record or clear them.
        if (isReference(ref.rawValue) || isEnvVarReference(ref.rawValue)) continue
        const target = opts.resolve(forkKind, ref.rawValue)
        const mapped = target != null
        opts.record?.(forkKind, ref.rawValue, mapped)
        if (mapped) {
          if (target !== ref.rawValue) {
            const replaced = definition.codec.replace(value, ref.rawValue, target)
            if (replaced.success) {
              value = replaced.nextValue
              if (opts.isCopiedTarget?.(forkKind, ref.rawValue)) {
                copyRemappedSubBlockIds.add(paramId)
              }
            }
          }
        } else if (opts.clearUnresolved) {
          // Drop only this unresolved entry (blank it - empties are filtered at parse
          // time), so a mixed copied/uncopied multi-value field keeps its copied refs.
          const replaced = definition.codec.replace(value, ref.rawValue, '')
          if (replaced.success) value = replaced.nextValue
        }
      }

      if (value !== currentValue) {
        setParam(paramKey, value)
        remappedParamIds.add(paramKey)
        remappedSubBlockIds.add(paramId)
      }
    }
  }

  if (remappedSubBlockIds.size > 0 && toolBlockSubBlocks) {
    const configBySubBlockId = new Map(
      toolBlockSubBlocks.filter((cfg) => cfg.id).map((cfg) => [cfg.id, cfg])
    )
    const currentParams = nextParams ?? params
    const readParam = (cfg: SubBlockConfig | undefined, subBlockId: string): unknown => {
      const direct = currentParams[subBlockId]
      if (direct != null && direct !== '') return direct
      const canonicalKey = cfg?.canonicalParamId
      return canonicalKey ? currentParams[canonicalKey] : direct
    }
    // A params key equal to a pair's shared `canonicalParamId` is also the advanced (manual)
    // member's write target. When the pair resolves to advanced, that key holds the
    // user-owned manual value - verbatim by policy, so the clear pass must not blank it.
    const isManualCanonicalValue = (cfg: SubBlockConfig | undefined, key: string): boolean =>
      cfg?.canonicalParamId === key && gates.isAdvancedActiveGroup(key)
    for (const subBlockId of remappedSubBlockIds) {
      const parentCfg = configBySubBlockId.get(subBlockId)
      const parentRemappedNonEmpty = isNonEmptyValue(readParam(parentCfg, subBlockId))
      const parentCopied = parentRemappedNonEmpty && copyRemappedSubBlockIds.has(subBlockId)
      for (const clear of getWorkflowSearchDependentClears(toolBlockSubBlocks, subBlockId)) {
        const dependentCfg = configBySubBlockId.get(clear.subBlockId)
        // A verbatim manual-parent dependent is never cleared, even when reachable from a
        // second (remapped) parent.
        if (gates.isManualParentDependent(clear.subBlockId)) continue
        // Tag fields are name/slot-based, portable onto a copied or mapped-equivalent
        // parent - preserve them when the parent remapped to a target instead of clearing.
        // A COPIED parent additionally keeps copy-faithful dependents (column picks - the
        // copy duplicates the table schema verbatim, so column ids stay valid).
        if (
          parentRemappedNonEmpty &&
          dependentCfg &&
          (PRESERVED_NAME_BASED_DEPENDENT_TYPES.has(dependentCfg.type) ||
            (parentCopied && PRESERVED_UNDER_COPY_DEPENDENT_TYPES.has(dependentCfg.type)))
        ) {
          continue
        }
        const clearKeys = new Set(
          [clear.subBlockId, dependentCfg?.canonicalParamId].filter(
            (key): key is string => typeof key === 'string' && key.length > 0
          )
        )
        // A dependent that was itself remapped followed the parent onto the target -
        // keep it (matching the top-level pass), under whichever key it was written.
        if ([...clearKeys].some((key) => remappedParamIds.has(key))) continue
        for (const clearKey of clearKeys) {
          const existing = currentParams[clearKey]
          if (existing === '' || existing == null) continue
          // User-owned references (`<block.out>` / `{{ENV}}`) resolve at runtime and are
          // never scoped to the old parent's id space - keep them verbatim.
          if (
            typeof existing === 'string' &&
            (isReference(existing) || isEnvVarReference(existing))
          ) {
            continue
          }
          if (isManualCanonicalValue(dependentCfg, clearKey)) continue
          setParam(clearKey, '')
        }
      }
    }
  }

  if (!nextParams) return tool
  return { ...tool, params: nextParams }
}

interface ForkToolInputOptions {
  /** Fork-create drops unresolved tools / clears params; promote keeps + records. */
  clearUnresolved: boolean
  record?: (kind: ForkRemapKind, sourceId: string, mapped: boolean) => void
  /** Target MCP server row lookup for rewriting a remapped MCP entry's server metadata. */
  resolveMcpServerMeta?: ForkMcpServerMetaResolver
  /** Copy provenance for a resolved target (see {@link RemapForkContext.isCopiedTarget}). */
  isCopiedTarget?: (kind: ForkRemapKind, sourceId: string) => boolean
  /** Block-level canonical-mode overrides (`${toolIndex}:`-scoped for nested tools). */
  parentCanonicalModes?: CanonicalModeOverrides
}

/**
 * Rewrite resource references inside a `tool-input` subblock (an array of
 * StoredTool). Custom-tool and MCP-server ids live in dedicated fields; every
 * other workspace-scoped id (credential, KB, table, file, MCP server) is nested in
 * a block tool's `params` and rewritten via {@link remapToolBlockResources}. The
 * MCP entry's derived `toolId` is rebuilt when the server id changes. On fork an
 * unresolved custom-tool/MCP tool is dropped; on promote it's kept and recorded.
 *
 * A dropped entry shifts every later tool's array position, so the owning block's
 * `canonicalModes` (index-scoped, see {@link reindexCanonicalModesByPosition}) must be
 * reindexed to match - tracked here by old/new POSITION rather than object identity, since a
 * kept-but-rewritten entry (a remapped `customToolId`/`serverId`) is a clone, not the same
 * reference as its source.
 */
function remapForkToolInputValue(
  value: unknown,
  resolve: ForkReferenceResolver,
  opts: ForkToolInputOptions
): { value: unknown; canonicalModes?: Record<string, 'basic' | 'advanced'> } {
  const { array, wasString } = coerceObjectArray(value)
  if (!array) return { value }
  let changed = false
  const next: unknown[] = []
  const newIndexByOldIndex = new Map<number, number>()

  array.forEach((tool, toolIndex) => {
    const keep = (nextTool: unknown) => {
      newIndexByOldIndex.set(toolIndex, next.length)
      next.push(nextTool)
    }

    if (!isRecord(tool) || typeof tool.type !== 'string') {
      keep(tool)
      return
    }
    if (tool.type === 'custom-tool' && typeof tool.customToolId === 'string') {
      const target = resolve('custom-tool', tool.customToolId)
      opts.record?.('custom-tool', tool.customToolId, target != null)
      if (target != null) {
        if (target !== tool.customToolId) {
          changed = true
          keep({ ...tool, customToolId: target })
          return
        }
        keep(tool)
        return
      }
      if (opts.clearUnresolved) {
        changed = true
        return // Dropped - later tools shift down.
      }
      keep(tool)
      return
    }
    if (tool.type === 'mcp' && isRecord(tool.params) && typeof tool.params.serverId === 'string') {
      const serverId = tool.params.serverId
      const target = resolve('mcp-server', serverId)
      opts.record?.('mcp-server', serverId, target != null)
      if (target != null) {
        if (target !== serverId) {
          changed = true
          const toolName =
            typeof tool.params.toolName === 'string' ? tool.params.toolName : undefined
          let nextParams: Record<string, unknown> = { ...tool.params, serverId: target }
          // The entry embeds the server's identity metadata (`serverUrl`/`serverName`); rewrite
          // it from the mapped TARGET row so the target UI never flags a false "URL changed"
          // stale badge against the source server's url (a url-less target drops the stale key).
          // The tool NAME stays verbatim - mapping asserts server equivalence; a name missing on
          // the target degrades to the existing tool_not_found badge / runtime skip. Without a
          // meta resolver (scan-only callers) the metadata is left as-is.
          const meta = opts.resolveMcpServerMeta?.(target)
          if (meta) {
            nextParams = { ...omit(nextParams, ['serverUrl']), serverName: meta.name }
            if (meta.url) nextParams.serverUrl = meta.url
          }
          keep({
            ...tool,
            params: nextParams,
            toolId: toolName ? createMcpToolId(target, toolName) : tool.toolId,
          })
          return
        }
        keep(tool)
        return
      }
      if (opts.clearUnresolved) {
        changed = true
        return // Dropped - later tools shift down.
      }
      keep(tool)
      return
    }
    const remapped = remapToolBlockResources(tool, {
      resolve,
      resolveFileKey: (key) => resolve('file', key) ?? null,
      record: opts.record,
      clearUnresolved: opts.clearUnresolved,
      isCopiedTarget: opts.isCopiedTarget,
      parentCanonicalModes: opts.parentCanonicalModes,
      toolIndex,
    })
    if (remapped !== tool) changed = true
    keep(remapped)
  })

  const canonicalModes = reindexCanonicalModesByPosition(
    newIndexByOldIndex,
    opts.parentCanonicalModes
  )
  if (!changed) return { value, canonicalModes }
  return { value: wasString ? JSON.stringify(next) : next, canonicalModes }
}

/**
 * Rewrite skill references inside a `skill-input` subblock (an array of
 * StoredSkill). Builtin skills (`builtin-*` ids) are workspace-agnostic and left
 * unchanged. On fork an unresolved skill is dropped; on promote it's kept + recorded.
 */
function remapForkSkillInputValue(
  value: unknown,
  resolve: ForkReferenceResolver,
  opts: ForkToolInputOptions
): unknown {
  const { array, wasString } = coerceObjectArray(value)
  if (!array) return value
  let changed = false
  const next = array.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.skillId !== 'string') return [entry]
    if (entry.skillId.startsWith('builtin-')) return [entry]
    const target = resolve('skill', entry.skillId)
    opts.record?.('skill', entry.skillId, target != null)
    if (target != null) {
      if (target !== entry.skillId) {
        changed = true
        return [{ ...entry, skillId: target }]
      }
      return [entry]
    }
    if (opts.clearUnresolved) {
      changed = true
      return []
    }
    return [entry]
  })
  if (!changed) return value
  return wasString ? JSON.stringify(next) : next
}

/**
 * Single subblock remapper shared by fork-create and promote (the `mode` selects
 * the policy - see below). Structured selectors use the search-replace registry
 * codecs; advanced-mode `manual*` overrides and nested tool params are handled by
 * id; `{{ENV}}` refs are inline string references. Returns the rewritten subBlocks
 * plus, in promote mode, the detected and still-unmapped references.
 */
export function remapForkSubBlocks(
  subBlocks: SubBlockRecord,
  resolve: ForkReferenceResolver,
  mode: 'create' | 'promote',
  context?: RemapForkContext
): RemapSubBlocksResult {
  const clearUnresolved = true
  const result: SubBlockRecord = {}
  const references = new Map<string, ForkReference>()
  const unmapped = new Map<string, ForkReference>()
  const remappedKeys = new Set<string>()
  const copyRemappedKeys = new Set<string>()
  /** MCP server ids remapped to a DIFFERENT mapped target this pass (source id -> target id). */
  const mcpServerRemaps = new Map<string, string>()
  /** Set when a `tool-input` subblock dropped an entry, shifting later tools' positions. */
  let reindexedCanonicalModes: CanonicalModeOverrides | undefined

  const recordReference = (key: string, reference: ForkReference, mapped: boolean) => {
    if (mode !== 'promote') return
    references.set(key, reference)
    if (!mapped) unmapped.set(key, reference)
  }

  // Mode policy (see {@link createCanonicalModeGates}): only the ACTIVE canonical member is a
  // real reference. An active BASIC selector is remapped + detected (mapping/copy/blockers); an
  // active ADVANCED (manual) member - and every dependent scoped to it - passes through VERBATIM
  // (user-owned, never remapped, never a mapping requirement); a DORMANT member's value is
  // CLEARED outright (below) so no stale id ever survives in an inactive slot. A condition-hidden
  // subblock is still rewritten but not detected. Needs `blockType` for the config; an unknown
  // block type gets no gating (everything detected, nothing passed through - the conservative
  // default).
  const gates = createCanonicalModeGates(
    context?.blockType ? getBlock(context.blockType)?.subBlocks : undefined,
    buildSubBlockValues(subBlocks),
    context?.canonicalModes
  )

  for (const [subBlockKey, subBlock] of Object.entries(subBlocks)) {
    if (!subBlock || typeof subBlock !== 'object') {
      result[subBlockKey] = subBlock
      continue
    }

    let value = subBlock.value
    const valueBeforeResource = value
    const subBlockType = typeof subBlock.type === 'string' ? subBlock.type : undefined

    const definition = getWorkflowSearchSubBlockResourceDefinition(
      subBlockType ? { type: subBlockType as SubBlockType } : undefined
    )
    const forkKind = definition ? REGISTRY_KIND_TO_FORK_KIND[definition.kind] : undefined

    // Mode policy per key: a DORMANT canonical member's value is cleared outright (only the
    // active mode matters - a stale inactive value must not survive the copy); a dependent
    // under a MANUAL (advanced-active) parent passes through verbatim; a condition-hidden
    // subblock is rewritten but never detected.
    const dormant = gates.isDormantMember(subBlockKey)
    const verbatimManualDependent = !dormant && gates.isManualParentDependent(subBlockKey)
    const detectionSkipped =
      dormant || verbatimManualDependent || gates.isConditionHidden(subBlockKey)
    if (dormant && isNonEmptyValue(value)) {
      value = ''
    }

    if (definition && forkKind && subBlockType && !verbatimManualDependent) {
      const parsed = parseWorkflowSearchSubBlockResources(value, {
        type: subBlockType as SubBlockType,
      })
      const seen = new Set<string>()
      for (const ref of parsed) {
        if (seen.has(ref.rawValue)) continue
        seen.add(ref.rawValue)
        const required = REQUIRED_KINDS.has(forkKind)
        const reference: ForkReference = {
          kind: forkKind,
          sourceId: ref.rawValue,
          blockId: context?.blockId,
          blockName: context?.blockName,
          subBlockKey,
          required,
        }
        const target = resolve(forkKind, ref.rawValue)
        const mapped = target != null
        if (!detectionSkipped) recordReference(`${forkKind}:${ref.rawValue}`, reference, mapped)
        if (mapped) {
          if (target !== ref.rawValue) {
            if (forkKind === 'mcp-server') mcpServerRemaps.set(ref.rawValue, target)
            const replaceResult = definition.codec.replace(value, ref.rawValue, target)
            if (replaceResult.success) {
              value = replaceResult.nextValue
              if (context?.isCopiedTarget?.(forkKind, ref.rawValue)) {
                copyRemappedKeys.add(subBlockKey)
              }
            }
          }
        } else if (clearUnresolved) {
          // Drop only this unresolved entry (blank it - empties are filtered at
          // parse time) so a mixed copied/uncopied multi-value field keeps its rest.
          const replaceResult = definition.codec.replace(value, ref.rawValue, '')
          if (replaceResult.success) value = replaceResult.nextValue
        }
      }
    }

    if (subBlockType === 'file-upload') {
      // Each workspace-file key is a `file` reference (keyed by storage key). Recording it
      // surfaces the file in the scan / unmapped set so a sync can copy it into the target,
      // exactly like fork - rather than silently clearing it. The resolver returns the copied
      // key once the file has been copied; an unmapped (uncopied) key is dropped by the remap
      // below. `file-selector` (external provider ids) is untouched.
      for (const fileKey of collectForkFileUploadKeys(value)) {
        if (detectionSkipped) break
        recordReference(
          `file:${fileKey}`,
          {
            kind: 'file',
            sourceId: fileKey,
            blockId: context?.blockId,
            blockName: context?.blockName,
            subBlockKey,
            required: false,
          },
          resolve('file', fileKey) != null
        )
      }
      value = remapForkFileUploadValue(value, (sourceKey) => resolve('file', sourceKey) ?? null)
    } else if (subBlockType === 'tool-input' || subBlockType === 'skill-input') {
      const record = (kind: ForkRemapKind, sourceId: string, mapped: boolean) => {
        if (detectionSkipped) return
        recordReference(
          `${kind}:${sourceId}`,
          {
            kind,
            sourceId,
            blockId: context?.blockId,
            blockName: context?.blockName,
            subBlockKey,
            required: REQUIRED_KINDS.has(kind),
          },
          mapped
        )
      }
      if (subBlockType === 'tool-input') {
        const toolInputResult = remapForkToolInputValue(value, resolve, {
          clearUnresolved,
          record,
          resolveMcpServerMeta: context?.resolveMcpServerMeta,
          isCopiedTarget: context?.isCopiedTarget,
          // Build on any reindex from an earlier `tool-input` subblock on this same block
          // (rare - most blocks have one), so multiple fields don't clobber each other.
          parentCanonicalModes: reindexedCanonicalModes ?? context?.canonicalModes,
        })
        value = toolInputResult.value
        if (toolInputResult.canonicalModes) reindexedCanonicalModes = toolInputResult.canonicalModes
      } else {
        value = remapForkSkillInputValue(value, resolve, { clearUnresolved, record })
      }
    }

    if (value !== valueBeforeResource) remappedKeys.add(subBlockKey)

    // Promote rewrites `{{ENV}}` refs via the resolver; fork preserves them by name. A hidden
    // field's ref is rewritten (kept verbatim when unmapped) but not recorded - it never
    // executes, so it must not become a required sync blocker.
    if (mode === 'promote') {
      value = remapEnvInValue(value, resolve, (sourceId, mapped) => {
        if (detectionSkipped) return
        recordReference(
          `env-var:${sourceId}`,
          {
            kind: 'env-var',
            sourceId,
            blockId: context?.blockId,
            blockName: context?.blockName,
            subBlockKey,
            required: true,
          },
          mapped
        )
      })
    }

    result[subBlockKey] = { ...subBlock, value }
  }

  // An MCP block's tool SELECTION follows its server's remap instead of clearing: the stored
  // value embeds the server id (`mcp-<serverId>-<toolName>`), so swap the embedded id for the
  // mapped target's and keep the tool NAME verbatim - mapping asserts the servers are
  // equivalent, mirroring how tool-input MCP entries keep their tool name. A value that does
  // not embed a remapped server id (a bare tool name) is already server-agnostic and kept
  // as-is. Deliberately NOT added to `remappedKeys`: the selection is preserved, so its own
  // dependents (the tool's arguments) must be preserved with it, and `clearDependentsOnRemap`
  // exempts the selector under a remapped (non-cleared) server parent.
  if (mcpServerRemaps.size > 0) {
    for (const [subBlockKey, subBlock] of Object.entries(result)) {
      if (!subBlock || typeof subBlock !== 'object') continue
      if (subBlock.type !== 'mcp-tool-selector') continue
      const toolValue = subBlock.value
      if (typeof toolValue !== 'string' || !toolValue) continue
      for (const [sourceServerId, targetServerId] of mcpServerRemaps) {
        const sourcePrefix = createMcpToolId(sourceServerId, '')
        if (!toolValue.startsWith(sourcePrefix)) continue
        result[subBlockKey] = {
          ...subBlock,
          value: createMcpToolId(targetServerId, toolValue.slice(sourcePrefix.length)),
        }
        break
      }
    }
  }

  return {
    subBlocks: result,
    references: Array.from(references.values()),
    unmapped: Array.from(unmapped.values()),
    remappedKeys,
    copyRemappedKeys,
    canonicalModes: reindexedCanonicalModes,
  }
}

/**
 * Clear every subblock whose `dependsOn` parent was remapped to a different
 * target this pass, so a child scoped to the old parent (a KB's document, a
 * Slack channel, a sheet tab) never carries a stale id into the target. Uses
 * the same dependent walk as search-replace (canonical-pair aware, transitive
 * over `dependsOn` chains) so fork/promote and in-editor search-replace clear
 * identically - with two remap-specific exemptions for dependents that stay
 * valid on the remapped target: an `mcp-tool-selector` under an
 * `mcp-server-selector` parent REMAPPED to a mapped target (its post-remap
 * value is non-empty) is preserved along with its own dependents (the tool's
 * arguments), because mapping asserts the servers are equivalent and
 * {@link remapForkSubBlocks} already followed the selection onto the target
 * server; and the name/slot-based tag fields (`knowledge-tag-filters`,
 * `document-tag-entry`) are preserved under any parent remapped to a non-empty
 * target - a copy duplicates the tag definitions verbatim and a mapping asserts
 * equivalence. A CLEARED parent (unmapped / fork-create) still clears its
 * dependents. Children of an unchanged parent are preserved; a no-op for
 * unknown block types or when nothing was remapped.
 */
export function clearDependentsOnRemap(
  subBlocks: SubBlockRecord,
  blockType: string,
  remappedKeys: ReadonlySet<string>,
  canonicalModes?: CanonicalModeOverrides,
  /** Keys remapped via a COPY (see {@link RemapSubBlocksResult.copyRemappedKeys}). */
  copyRemappedKeys?: ReadonlySet<string>
): SubBlockRecord {
  if (remappedKeys.size === 0) return subBlocks
  const config = getBlock(blockType)
  if (!config) return subBlocks

  // Only a remap of the ACTIVE canonical member should clear its dependents: a dormant member's
  // stale value being remapped/cleared must not clear a child that hangs off the active parent
  // (only the active mode is serialized). With `canonicalModes` absent the value heuristic keeps a
  // populated basic member active, so this is a no-op for the normal case; the gate only bites the
  // toggle-with-stale-dormant edge (advanced active + a dormant basic that was remapped).
  const gates = createCanonicalModeGates(
    config.subBlocks,
    buildSubBlockValues(subBlocks),
    canonicalModes
  )

  // The exemption's parent test: an mcp-server selector whose POST-remap value is non-empty was
  // remapped to a mapped target (a cleared one is empty), so its tool selection is preserved.
  const configTypeById = new Map(
    config.subBlocks.filter((cfg) => cfg.id).map((cfg) => [cfg.id, cfg.type])
  )
  const isRemappedMcpServerParent = (key: string): boolean => {
    if (configTypeById.get(key.replace(/_\d+$/, '')) !== 'mcp-server-selector') return false
    const parent = subBlocks[key]
    return parent && typeof parent === 'object' ? isNonEmptyValue(parent.value) : false
  }

  // A parent key remapped to a non-empty target (a cleared one is empty post-remap): its
  // name/slot-based dependents (tag filters / document tags) stay valid on the target -
  // mapping asserts equivalence and a copy duplicates the tag definitions verbatim.
  const isRemappedToNonEmpty = (key: string): boolean => {
    const parent = subBlocks[key]
    return parent && typeof parent === 'object' ? isNonEmptyValue(parent.value) : false
  }

  // The preserve decision is hoisted out of the per-key walk and keyed on the DEPENDENT (not on
  // which remapped key reaches it): `toClear` is a union across per-key BFS passes (each with its
  // own `visited`), so an in-loop exemption holds only against the exempting key - a second
  // remapped key (or a longer dependsOn path) reaching the same dependent would re-add it.
  // Preserved: an `mcp-tool-selector` under a remapped (non-empty) `mcp-server-selector`, and the
  // name-based tag fields under ANY parent remapped to a non-empty target.
  const preservedDependents = new Set<string>()
  for (const key of remappedKeys) {
    if (gates.isDormantMember(key)) continue
    const mcpParent = isRemappedMcpServerParent(key)
    const nonEmptyParent = isRemappedToNonEmpty(key)
    const copiedParent = nonEmptyParent && (copyRemappedKeys?.has(key) ?? false)
    if (!mcpParent && !nonEmptyParent) continue
    for (const dependent of getSubBlocksDependingOnChange(config.subBlocks, key)) {
      if (!dependent.id) continue
      if (mcpParent && dependent.type === 'mcp-tool-selector') {
        preservedDependents.add(dependent.id)
      }
      if (nonEmptyParent && PRESERVED_NAME_BASED_DEPENDENT_TYPES.has(dependent.type)) {
        preservedDependents.add(dependent.id)
      }
      if (copiedParent && PRESERVED_UNDER_COPY_DEPENDENT_TYPES.has(dependent.type)) {
        preservedDependents.add(dependent.id)
      }
    }
  }

  // Same BFS as `getWorkflowSearchDependentClears`, with each preserved dependent's subtree
  // pruned (skipping it keeps its own dependents - e.g. a tool's arguments - out of the clear
  // set). A dependent under an ACTIVE MANUAL parent is verbatim by policy (the manual value is
  // never remapped), so it is pruned the same way.
  const toClear = new Set<string>()
  for (const key of remappedKeys) {
    if (gates.isDormantMember(key)) continue
    const visited = new Set<string>([key])
    const queue = [key]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      for (const dependent of getSubBlocksDependingOnChange(config.subBlocks, current)) {
        if (!dependent.id || visited.has(dependent.id)) continue
        if (preservedDependents.has(dependent.id)) continue
        if (gates.isManualParentDependent(dependent.id)) continue
        visited.add(dependent.id)
        if (!remappedKeys.has(dependent.id)) toClear.add(dependent.id)
        queue.push(dependent.id)
      }
    }
  }

  let next: SubBlockRecord | null = null
  for (const id of toClear) {
    const existing = subBlocks[id]
    if (!existing || typeof existing !== 'object') continue
    if (existing.value === '' || existing.value == null) continue
    // User-owned references (`<block.out>` / `{{ENV}}`) resolve at runtime and are never
    // scoped to the old parent's id space - keep them verbatim.
    if (
      typeof existing.value === 'string' &&
      (isReference(existing.value) || isEnvVarReference(existing.value))
    ) {
      continue
    }
    // A live manual (advanced) member is user-owned and verbatim by policy - a parent remap
    // must not blank it (matching how manual values are never remapped). A dormant one may.
    if (gates.isActiveManualMember(id)) continue
    next ??= { ...subBlocks }
    next[id] = { ...existing, value: '' }
  }
  return next ?? subBlocks
}

/**
 * A dependent field a sync left empty (it had a source value). `required` ones gate Sync
 * and skip redeploy; optional ones are surfaced so a cleared filter never broadens silently.
 */
export interface NeedsConfigurationField {
  blockId: string
  blockName: string
  subBlockKey: string
  /** Plain field title (e.g. `Label`), never a `Tool: Field` composite. */
  title: string
  /** Nested `tool-input` tool display name when the field lives under a tool. */
  toolName?: string
  required: boolean
}

/** Evaluate a subblock's `required` (boolean | condition | fn) against a value map. */
export function isSubBlockRequired(
  required: SubBlockConfig['required'],
  values: Record<string, unknown>
): boolean {
  if (required === true) return true
  if (!required) return false
  // The object/function forms are structurally a SubBlockCondition.
  return evaluateSubBlockCondition(
    required as Parameters<typeof evaluateSubBlockCondition>[0],
    values
  )
}

/** Nested `tool-input` dependents (Agent/tool blocks) the TARGET configured that a remap cleared. */
function collectClearedToolParamDependents(
  toolInputKey: string,
  blockId: string,
  blockName: string,
  targetCurrentValue: unknown,
  mergedValue: unknown,
  out: NeedsConfigurationField[],
  parentCanonicalModes?: CanonicalModeOverrides
): void {
  const { array: targetTools } = coerceObjectArray(targetCurrentValue)
  const { array: mergedTools } = coerceObjectArray(mergedValue)
  if (!mergedTools || !targetTools) return
  // Index pairing is only safe when the tool sets line up; otherwise skip rather than
  // pair a cleared param against the wrong tool.
  if (targetTools.length !== mergedTools.length) return
  for (let index = 0; index < mergedTools.length; index++) {
    const tool = mergedTools[index]
    const targetTool = targetTools[index]
    if (!isRecord(tool) || typeof tool.type !== 'string') continue
    if (!isRecord(targetTool) || targetTool.type !== tool.type) continue
    const toolConfig = getBlock(tool.type)
    if (!toolConfig) continue
    const targetParams = isRecord(targetTool.params) ? targetTool.params : {}
    const mergedParams = isRecord(tool.params) ? tool.params : {}
    // A tool's `operation` lives at the tool level, not in params, but conditions
    // reference it - merge it in so condition/required gating matches the editor.
    const mergedValues =
      typeof tool.operation === 'string'
        ? { operation: tool.operation, ...mergedParams }
        : mergedParams
    // A DORMANT canonical member's cleared slot is not a lost configuration (only the pair's
    // active member executes). Modes resolve like the tool-input UI: tool-scoped overrides,
    // then the value heuristic over the merged params.
    const gates = createCanonicalModeGates(
      toolConfig.subBlocks,
      mergedValues,
      scopeCanonicalModesForTool(parentCanonicalModes, index, tool.type)
    )
    const toolLabel = typeof tool.title === 'string' && tool.title ? tool.title : toolConfig.name
    for (const cfg of toolConfig.subBlocks) {
      if (!cfg.dependsOn || !cfg.id) continue
      // Only flag a param the TARGET tool had configured (not one the source carried in).
      if (!isNonEmptyValue(targetParams[cfg.id])) continue
      if (isNonEmptyValue(mergedParams[cfg.id])) continue
      if (gates.isDormantMember(cfg.id)) continue
      // Skip fields gated off by their `condition` (a stale value under an inactive
      // operation isn't actually required now).
      if (cfg.condition && !evaluateSubBlockCondition(cfg.condition, mergedValues)) continue
      out.push({
        blockId,
        blockName,
        subBlockKey: `${toolInputKey}[${index}].${cfg.id}`,
        title: cfg.title ?? cfg.id,
        toolName: toolLabel,
        required: isSubBlockRequired(cfg.required, mergedValues),
      })
    }
  }
}

/**
 * `dependsOn` children the TARGET workspace had configured (in its draft) that the merge
 * left empty - the parent they hang off was swapped/remapped and the value wasn't restored
 * or re-picked. Keyed on the TARGET draft (not the source) so a field the source carries
 * but the target never configured is NOT flagged (e.g. a pull bringing in the parent's
 * label filter the fork never set). Covers top-level subblocks AND nested `tool-input`
 * params. `required` ones must be re-picked before the workflow can run (promote skips
 * their redeploy); optional ones are surfaced so a filter the swap cleared never broadens
 * behavior silently. Pure; `mergedSubBlocks` is the final state about to be written,
 * `targetCurrentSubBlocks` the target's pre-sync draft.
 */
export function collectClearedDependents(
  blockType: string,
  blockId: string,
  blockName: string,
  targetCurrentSubBlocks: SubBlockRecord,
  mergedSubBlocks: SubBlockRecord,
  canonicalModes?: CanonicalModeOverrides
): NeedsConfigurationField[] {
  const config = getBlock(blockType)
  if (!config) return []
  const targetValues = buildSubBlockValues(targetCurrentSubBlocks)
  const mergedValues = buildSubBlockValues(mergedSubBlocks)
  // A DORMANT canonical member the merge cleared is not a lost configuration - only the pair's
  // active member executes, so an inactive slot must never demand a re-pick.
  const gates = createCanonicalModeGates(config.subBlocks, mergedValues, canonicalModes)
  const fields: NeedsConfigurationField[] = []
  for (const cfg of config.subBlocks) {
    if (!cfg.id) continue
    // Only flag a field the target had configured (so the user lost their own selection),
    // still empty after merge, and currently active (a value under a now-inactive
    // `condition`/operation or a dormant canonical member isn't really in play).
    if (
      cfg.dependsOn &&
      isNonEmptyValue(targetValues[cfg.id]) &&
      !isNonEmptyValue(mergedValues[cfg.id]) &&
      !gates.isDormantMember(cfg.id) &&
      (!cfg.condition || evaluateSubBlockCondition(cfg.condition, mergedValues))
    ) {
      fields.push({
        blockId,
        blockName,
        subBlockKey: cfg.id,
        title: cfg.title ?? cfg.id,
        required: isSubBlockRequired(cfg.required, mergedValues),
      })
    }
    if (cfg.type === 'tool-input') {
      collectClearedToolParamDependents(
        cfg.id,
        blockId,
        blockName,
        targetValues[cfg.id],
        mergedValues[cfg.id],
        fields,
        canonicalModes
      )
    }
  }
  return fields
}

/**
 * Parse a nested dependent/override key `toolInput[index].paramId` into its parts (the index
 * coerced to a number). Returns null for a plain top-level subblock key. Shared by the diff's
 * first-sync draft reader and the override apply so both parse the `toolInput[index].paramId`
 * shape identically.
 */
export function parseNestedDependentKey(
  key: string
): { toolInputId: string; index: number; paramId: string } | null {
  const match = /^([^[]+)\[(\d+)\]\.(.+)$/.exec(key)
  if (!match) return null
  const [, toolInputId, indexStr, paramId] = match
  return { toolInputId, index: Number(indexStr), paramId }
}

/**
 * Read a dependent field's currently-configured value from a target block's draft subBlocks -
 * the first-sync fallback used when the stored mapping has no entry yet (fork-create seeds
 * mappings but no dependent values, so every edge starts here). Seeds the diff pre-fill from
 * the TARGET (never the source, which would overwrite the target's own selection).
 * Identity-aware: for a nested `toolInput[index].paramId` key it only
 * reads the target draft's param when the target tool at that index is the SAME tool type the
 * SOURCE dependent hangs off; otherwise that index holds a different tool whose value isn't this
 * field's. Returns '' when unset or when identity can't be verified.
 *
 * Both records are read structurally (only each subblock's `value`), so callers can pass either a
 * persisted {@link SubBlockRecord} (the target draft) or an in-memory `WorkflowState` block's
 * subblocks (the source) without a cast.
 */
export function readTargetDraftDependentValue(
  targetDraftSubBlocks: Record<string, { value?: unknown }> | undefined,
  sourceSubBlocks: Record<string, { value?: unknown }> | undefined,
  subBlockKey: string
): string {
  if (!targetDraftSubBlocks) return ''
  const nested = parseNestedDependentKey(subBlockKey)
  if (nested) {
    const { toolInputId, index, paramId } = nested
    const targetTool = coerceObjectArray(targetDraftSubBlocks[toolInputId]?.value).array?.[index]
    if (!isRecord(targetTool) || typeof targetTool.type !== 'string') return ''
    const sourceTool = coerceObjectArray(sourceSubBlocks?.[toolInputId]?.value).array?.[index]
    if (!isRecord(sourceTool) || sourceTool.type !== targetTool.type) return ''
    const params = isRecord(targetTool.params) ? targetTool.params : {}
    const value = params[paramId]
    return typeof value === 'string' ? value : ''
  }
  // TODO(fork): identity-guard top-level reads too - only seed when the target draft's parent
  // (credential/KB/table) still equals the mapped target. Threading the parent subblock id and
  // mapped target value here is invasive, and a changed parent is already blanked by the modal's
  // `parentChanged` logic, leaving only a narrow same-index/different-parent first-sync edge.
  const value = targetDraftSubBlocks[subBlockKey]?.value
  return typeof value === 'string' ? value : ''
}

/**
 * Apply nested `tool-input` overrides onto one tool array, matching by index and
 * allowlisting each param to the tool's own reconfigurable dependents (dependsOn +
 * selectorKey). Returns the same reference when nothing applied. Handles the array and
 * JSON-string stored shapes.
 */
function applyNestedToolOverrides(
  value: unknown,
  items: ReadonlyArray<{ index: number; paramId: string; value: string }>
): unknown {
  const { array, wasString } = coerceObjectArray(value)
  if (!array) return value
  let changed = false
  const merged = array.map((tool, index) => {
    const forTool = items.filter((item) => item.index === index)
    if (forTool.length === 0) return tool
    if (!isRecord(tool) || typeof tool.type !== 'string') return tool
    const toolConfig = getBlock(tool.type)
    if (!toolConfig) return tool
    const allowed = new Set(
      toolConfig.subBlocks
        .filter((cfg) => cfg.id && cfg.dependsOn && cfg.selectorKey)
        .map((cfg) => cfg.id)
    )
    const params = isRecord(tool.params) ? tool.params : {}
    let nextParams: Record<string, unknown> | null = null
    for (const item of forTool) {
      if (!allowed.has(item.paramId)) continue
      nextParams ??= { ...params }
      nextParams[item.paramId] = item.value
    }
    if (!nextParams) return tool
    changed = true
    return { ...tool, params: nextParams }
  })
  if (!changed) return value
  return wasString ? JSON.stringify(merged) : merged
}

/**
 * Apply the stored dependent mapping onto the merged subBlocks (called last, after the
 * reference transform cleared the source's dependent values, so the stored mapping is the sole
 * source of truth for what each selector resolves to). Allowlisted to the block's
 * reconfigurable dependent selectors (`dependsOn` + `selectorKey`) - top-level subblocks AND
 * nested `tool-input` params keyed `toolInput[index].paramId` - so a crafted value can never
 * set a parent/credential field (bypassing mapping validation) or inject a bogus subblock.
 * Returns a new record only when something applied.
 */
export function applyDependentOverrides(
  subBlocks: SubBlockRecord,
  blockType: string,
  overrides: ReadonlyMap<string, string>
): SubBlockRecord {
  const config = getBlock(blockType)
  if (!config || overrides.size === 0) return subBlocks

  const allowedTopLevel = new Set<string>()
  const toolInputIds = new Set<string>()
  for (const cfg of config.subBlocks) {
    if (!cfg.id) continue
    if (cfg.dependsOn && cfg.selectorKey) allowedTopLevel.add(cfg.id)
    if (cfg.type === 'tool-input') toolInputIds.add(cfg.id)
  }

  const nestedByTool = new Map<string, Array<{ index: number; paramId: string; value: string }>>()
  let next: SubBlockRecord | null = null

  for (const [key, value] of overrides) {
    const nested = parseNestedDependentKey(key)
    if (nested) {
      if (!toolInputIds.has(nested.toolInputId)) continue
      const list = nestedByTool.get(nested.toolInputId) ?? []
      list.push({ index: nested.index, paramId: nested.paramId, value })
      nestedByTool.set(nested.toolInputId, list)
      continue
    }
    if (!allowedTopLevel.has(key)) continue
    next ??= { ...subBlocks }
    // The allowlist already proves this is a real dependent selector, so create the entry
    // if the merge dropped it (don't silently skip a legitimate re-pick).
    const existing = next[key]
    next[key] = existing && typeof existing === 'object' ? { ...existing, value } : { value }
  }

  for (const [toolInputId, items] of nestedByTool) {
    const existing = (next ?? subBlocks)[toolInputId]
    if (!existing || typeof existing !== 'object') continue
    const updated = applyNestedToolOverrides(existing.value, items)
    if (updated === existing.value) continue
    next ??= { ...subBlocks }
    next[toolInputId] = { ...existing, value: updated }
  }

  return next ?? subBlocks
}

/**
 * Promote-mode remap (keep + record unmapped references). Thin wrapper over
 * {@link remapForkSubBlocks}; also used by the reference scan.
 */
export function remapSubBlocks(
  subBlocks: SubBlockRecord,
  resolve: ForkReferenceResolver,
  context?: RemapForkContext
): RemapSubBlocksResult {
  return remapForkSubBlocks(subBlocks, resolve, 'promote', context)
}

/** A `copyWorkflowStateIntoTarget` subBlock transform that rewrites references via the resolver. */
export function createForkSubBlockTransform(
  resolve: ForkReferenceResolver,
  options?: {
    /** Mapped-target MCP server rows, so remapped tool-input entries rewrite their server metadata. */
    resolveMcpServerMeta?: ForkMcpServerMetaResolver
    /** Copy provenance (promote's copy-selection overlay), keeping copy-faithful dependents. */
    isCopiedTarget?: (kind: ForkRemapKind, sourceId: string) => boolean
  }
): SubBlockTransform {
  return (subBlocks, blockType, canonicalModes, onCanonicalModesChanged) => {
    const result = remapSubBlocks(subBlocks, resolve, {
      blockType,
      canonicalModes,
      resolveMcpServerMeta: options?.resolveMcpServerMeta,
      isCopiedTarget: options?.isCopiedTarget,
    })
    if (result.canonicalModes) onCanonicalModesChanged?.(result.canonicalModes)
    return clearDependentsOnRemap(
      result.subBlocks,
      blockType,
      result.remappedKeys,
      result.canonicalModes ?? canonicalModes,
      result.copyRemappedKeys
    )
  }
}

export interface WorkflowReferenceScan {
  references: ForkReference[]
  unmapped: ForkReference[]
}

/**
 * Scan a set of blocks for all remappable references, aggregating unique
 * (kind, sourceId) pairs across the workflow. Used by the mapping/diff/promote
 * paths to surface what needs mapping and to block on unmapped required refs.
 */
export function scanWorkflowReferences(
  blocks: Array<{
    id: string
    name: string
    /** Block type, so detection can collapse a canonical pair to its active member. */
    type?: string
    subBlocks: unknown
    /** `block.data.canonicalModes`, picking the active member per canonical pair for detection. */
    canonicalModes?: CanonicalModeOverrides
  }>,
  resolve: ForkReferenceResolver
): WorkflowReferenceScan {
  const references = new Map<string, ForkReference>()
  const unmapped = new Map<string, ForkReference>()

  for (const block of blocks) {
    if (!block.subBlocks || typeof block.subBlocks !== 'object' || Array.isArray(block.subBlocks)) {
      continue
    }
    const blockResult = remapSubBlocks(block.subBlocks as SubBlockRecord, resolve, {
      blockId: block.id,
      blockName: block.name,
      blockType: block.type,
      canonicalModes: block.canonicalModes,
    })
    for (const reference of blockResult.references) {
      const key = `${reference.kind}:${reference.sourceId}`
      if (!references.has(key)) references.set(key, reference)
    }
    for (const reference of blockResult.unmapped) {
      const key = `${reference.kind}:${reference.sourceId}`
      if (!unmapped.has(key)) unmapped.set(key, reference)
    }
  }

  return {
    references: Array.from(references.values()),
    unmapped: Array.from(unmapped.values()),
  }
}
