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
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import type { ParsedStoredTool } from '@/lib/workflows/tool-input/types'
import {
  collectForkFileUploadKeys,
  remapForkFileUploadValue,
} from '@/lib/workspaces/fork/remap/remap-files'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { getSubBlocksDependingOnChange } from '@/blocks/utils'

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
 * A `credentialSet:<id>` reference points at an ORG-scoped credential set. A fork
 * inherits its parent's org, so the set is already valid in the target — these refs
 * are preserved verbatim and never treated as a workspace credential to remap/flag.
 */
function isCredentialSetRef(value: string): boolean {
  return value.startsWith('credentialSet:')
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

  // Id-keyed resource params (credential / triggerCredentials / manual* overrides):
  // walked from the raw params so they're caught even when their config is filtered
  // out by a reactive condition (the registry loop below would otherwise miss them).
  for (const paramId of Object.keys(params)) {
    const overrideKind = getToolParamOverrideKind(paramId)
    if (!overrideKind) continue
    const currentValue = params[paramId]
    if (typeof currentValue !== 'string' || !currentValue) continue
    if (overrideKind === 'credential' && isCredentialSetRef(currentValue)) continue
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
    configs = getToolInputParamConfigs({ tool: toolView, blockConfigs: opts.blockConfigs })
  } catch (error) {
    // Unknown block / resolver failure: don't crash the fork/promote, but log so a
    // real bug isn't masked. Nested resource ids in this tool stay as-is.
    logger.warn('Could not resolve tool params for fork remap', {
      toolType: tool.type,
      error: getErrorMessage(error),
    })
    return nextParams ? { ...tool, params: nextParams } : tool
  }

  for (const { paramId, config } of configs) {
    if (getToolParamOverrideKind(paramId)) continue
    const definition = getWorkflowSearchSubBlockResourceDefinition(config)
    if (!definition) continue
    const currentValue = (nextParams ?? params)[paramId]

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
        setParam(paramId, remapped)
        remappedParamIds.add(paramId)
      }
      continue
    }

    const forkKind = REGISTRY_KIND_TO_FORK_KIND[definition.kind]
    if (!forkKind) continue

    const refs = parseWorkflowSearchSubBlockResources(currentValue, config)
    if (refs.length === 0) continue

    let value = currentValue
    const seen = new Set<string>()
    for (const ref of refs) {
      if (seen.has(ref.rawValue)) continue
      seen.add(ref.rawValue)
      if (forkKind === 'credential' && isCredentialSetRef(ref.rawValue)) continue
      const target = opts.resolve(forkKind, ref.rawValue)
      const mapped = target != null
      opts.record?.(forkKind, ref.rawValue, mapped)
      if (mapped) {
        if (target !== ref.rawValue) {
          const replaced = definition.codec.replace(value, ref.rawValue, target)
          if (replaced.success) value = replaced.nextValue
        }
      } else if (opts.clearUnresolved) {
        // Drop only this unresolved entry (blank it - empties are filtered at parse
        // time), so a mixed copied/uncopied multi-value field keeps its copied refs.
        const replaced = definition.codec.replace(value, ref.rawValue, '')
        if (replaced.success) value = replaced.nextValue
      }
    }

    if (value !== currentValue) {
      setParam(paramId, value)
      remappedParamIds.add(paramId)
    }
  }

  if (remappedParamIds.size > 0) {
    const toolBlockConfig = opts.blockConfigs?.[tool.type] ?? getBlock(tool.type)
    const toolSubBlocks = toolBlockConfig?.subBlocks
    if (toolSubBlocks) {
      const currentParams = nextParams ?? params
      for (const paramId of remappedParamIds) {
        for (const clear of getWorkflowSearchDependentClears(toolSubBlocks, paramId)) {
          if (remappedParamIds.has(clear.subBlockId)) continue
          const existing = currentParams[clear.subBlockId]
          if (existing === '' || existing == null) continue
          setParam(clear.subBlockId, '')
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
}

/**
 * Rewrite resource references inside a `tool-input` subblock (an array of
 * StoredTool). Custom-tool and MCP-server ids live in dedicated fields; every
 * other workspace-scoped id (credential, KB, table, file, MCP server) is nested in
 * a block tool's `params` and rewritten via {@link remapToolBlockResources}. The
 * MCP entry's derived `toolId` is rebuilt when the server id changes. On fork an
 * unresolved custom-tool/MCP tool is dropped; on promote it's kept and recorded.
 */
function remapForkToolInputValue(
  value: unknown,
  resolve: ForkReferenceResolver,
  opts: ForkToolInputOptions
): unknown {
  const { array, wasString } = coerceObjectArray(value)
  if (!array) return value
  let changed = false
  const next = array.flatMap((tool) => {
    if (!isRecord(tool) || typeof tool.type !== 'string') return [tool]
    if (tool.type === 'custom-tool' && typeof tool.customToolId === 'string') {
      const target = resolve('custom-tool', tool.customToolId)
      opts.record?.('custom-tool', tool.customToolId, target != null)
      if (target != null) {
        if (target !== tool.customToolId) {
          changed = true
          return [{ ...tool, customToolId: target }]
        }
        return [tool]
      }
      if (opts.clearUnresolved) {
        changed = true
        return []
      }
      return [tool]
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
          return [
            {
              ...tool,
              params: nextParams,
              toolId: toolName ? createMcpToolId(target, toolName) : tool.toolId,
            },
          ]
        }
        return [tool]
      }
      if (opts.clearUnresolved) {
        changed = true
        return []
      }
      return [tool]
    }
    const remapped = remapToolBlockResources(tool, {
      resolve,
      resolveFileKey: (key) => resolve('file', key) ?? null,
      record: opts.record,
      clearUnresolved: opts.clearUnresolved,
    })
    if (remapped !== tool) changed = true
    return [remapped]
  })
  if (!changed) return value
  return wasString ? JSON.stringify(next) : next
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
  /** MCP server ids remapped to a DIFFERENT mapped target this pass (source id -> target id). */
  const mcpServerRemaps = new Map<string, string>()

  const recordReference = (key: string, reference: ForkReference, mapped: boolean) => {
    if (mode !== 'promote') return
    references.set(key, reference)
    if (!mapped) unmapped.set(key, reference)
  }

  // DETECTION gate: a DORMANT canonical member's stale value must not be recorded as a reference
  // (so it is never offered as a required mapping / copyable / usage and can't gate sync). The value
  // REWRITE below is untouched - both basic + advanced ids are still remapped. Needs `blockType` to
  // build the canonical index; callers that omit it (create-mode transforms) keep today's detection,
  // and with `canonicalModes` absent the value heuristic keeps a populated member active (no-op).
  const canonicalIndex = context?.blockType
    ? buildCanonicalIndex(getBlock(context.blockType)?.subBlocks ?? [])
    : undefined
  const detectionValues = canonicalIndex ? buildSubBlockValues(subBlocks) : {}
  const isDormantCanonicalMember = (key: string): boolean => {
    if (!canonicalIndex) return false
    const baseKey = key.replace(/_\d+$/, '')
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[baseKey]
    const group = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined
    if (!group || !isCanonicalPair(group)) return false
    const activeMode = resolveCanonicalMode(group, detectionValues, context?.canonicalModes)
    return (activeMode === 'advanced') !== group.advancedIds.includes(baseKey)
  }

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

    if (definition && forkKind && subBlockType) {
      // A dormant canonical member is rewritten (below) but NOT detected as a reference.
      const isDormant = isDormantCanonicalMember(subBlockKey)
      const parsed = parseWorkflowSearchSubBlockResources(value, {
        type: subBlockType as SubBlockType,
      })
      const seen = new Set<string>()
      for (const ref of parsed) {
        if (seen.has(ref.rawValue)) continue
        seen.add(ref.rawValue)
        if (forkKind === 'credential' && isCredentialSetRef(ref.rawValue)) continue
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
        if (!isDormant) recordReference(`${forkKind}:${ref.rawValue}`, reference, mapped)
        if (mapped) {
          if (target !== ref.rawValue) {
            if (forkKind === 'mcp-server') mcpServerRemaps.set(ref.rawValue, target)
            const replaceResult = definition.codec.replace(value, ref.rawValue, target)
            if (replaceResult.success) value = replaceResult.nextValue
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
      const record = (kind: ForkRemapKind, sourceId: string, mapped: boolean) =>
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
      value =
        subBlockType === 'tool-input'
          ? remapForkToolInputValue(value, resolve, {
              clearUnresolved,
              record,
              resolveMcpServerMeta: context?.resolveMcpServerMeta,
            })
          : remapForkSkillInputValue(value, resolve, { clearUnresolved, record })
    }

    if (value !== valueBeforeResource) remappedKeys.add(subBlockKey)

    // Promote rewrites `{{ENV}}` refs via the resolver; fork preserves them by name.
    if (mode === 'promote') {
      value = remapEnvInValue(value, resolve, (sourceId, mapped) => {
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
  }
}

/**
 * Clear every subblock whose `dependsOn` parent was remapped to a different
 * target this pass, so a child scoped to the old parent (a KB's document, a
 * Slack channel, a sheet tab) never carries a stale id into the target. Uses
 * the same dependent walk as search-replace (canonical-pair aware, transitive
 * over `dependsOn` chains) so fork/promote and in-editor search-replace clear
 * identically - with ONE remap-specific exemption: an `mcp-tool-selector` under
 * an `mcp-server-selector` parent that was REMAPPED to a mapped target (its
 * post-remap value is non-empty) is preserved along with its own dependents
 * (the tool's arguments), because mapping asserts the servers are equivalent
 * and {@link remapForkSubBlocks} already followed the selection onto the target
 * server. A CLEARED server (unmapped / fork-create) still clears its dependents.
 * Children of an unchanged parent are preserved; a no-op for unknown block
 * types or when nothing was remapped.
 */
export function clearDependentsOnRemap(
  subBlocks: SubBlockRecord,
  blockType: string,
  remappedKeys: ReadonlySet<string>,
  canonicalModes?: CanonicalModeOverrides
): SubBlockRecord {
  if (remappedKeys.size === 0) return subBlocks
  const config = getBlock(blockType)
  if (!config) return subBlocks

  // Only a remap of the ACTIVE canonical member should clear its dependents: a dormant member's
  // stale value being remapped/cleared must not clear a child that hangs off the active parent
  // (only the active mode is serialized). With `canonicalModes` absent the value heuristic keeps a
  // populated basic member active, so this is a no-op for the normal case; the gate only bites the
  // toggle-with-stale-dormant edge (advanced active + a dormant basic that was remapped).
  const canonicalIndex = buildCanonicalIndex(config.subBlocks)
  const values = buildSubBlockValues(subBlocks)
  const isDormantCanonicalMember = (key: string): boolean => {
    const baseKey = key.replace(/_\d+$/, '')
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[baseKey]
    const group = canonicalId ? canonicalIndex.groupsById[canonicalId] : undefined
    if (!group || !isCanonicalPair(group)) return false
    const mode = resolveCanonicalMode(group, values, canonicalModes)
    return (mode === 'advanced') !== group.advancedIds.includes(baseKey)
  }

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

  // Same BFS as `getWorkflowSearchDependentClears`, with the preserved tool selector's subtree
  // pruned (skipping it keeps its own dependents - the arguments - out of the clear set too).
  const toClear = new Set<string>()
  for (const key of remappedKeys) {
    if (isDormantCanonicalMember(key)) continue
    const preserveMcpToolDependents = isRemappedMcpServerParent(key)
    const visited = new Set<string>([key])
    const queue = [key]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      for (const dependent of getSubBlocksDependingOnChange(config.subBlocks, current)) {
        if (!dependent.id || visited.has(dependent.id)) continue
        if (
          preserveMcpToolDependents &&
          current === key &&
          dependent.type === 'mcp-tool-selector'
        ) {
          continue
        }
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
  title: string
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
  out: NeedsConfigurationField[]
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
    const toolLabel = typeof tool.title === 'string' && tool.title ? tool.title : toolConfig.name
    for (const cfg of toolConfig.subBlocks) {
      if (!cfg.dependsOn || !cfg.id) continue
      // Only flag a param the TARGET tool had configured (not one the source carried in).
      if (!isNonEmptyValue(targetParams[cfg.id])) continue
      if (isNonEmptyValue(mergedParams[cfg.id])) continue
      // Skip fields gated off by their `condition` (a stale value under an inactive
      // operation isn't actually required now).
      if (cfg.condition && !evaluateSubBlockCondition(cfg.condition, mergedValues)) continue
      out.push({
        blockId,
        blockName,
        subBlockKey: `${toolInputKey}[${index}].${cfg.id}`,
        title: `${toolLabel}: ${cfg.title ?? cfg.id}`,
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
  mergedSubBlocks: SubBlockRecord
): NeedsConfigurationField[] {
  const config = getBlock(blockType)
  if (!config) return []
  const targetValues = buildSubBlockValues(targetCurrentSubBlocks)
  const mergedValues = buildSubBlockValues(mergedSubBlocks)
  const fields: NeedsConfigurationField[] = []
  for (const cfg of config.subBlocks) {
    if (!cfg.id) continue
    // Only flag a field the target had configured (so the user lost their own selection),
    // still empty after merge, and currently active (a value under a now-inactive
    // `condition`/operation isn't really in play).
    if (
      cfg.dependsOn &&
      isNonEmptyValue(targetValues[cfg.id]) &&
      !isNonEmptyValue(mergedValues[cfg.id]) &&
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
        fields
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
 * the first-sync fallback used when the stored mapping has no entry yet. Seeds the diff pre-fill
 * from the TARGET (never the source, which would overwrite the target's own selection on an edge
 * that predates the store). Identity-aware: for a nested `toolInput[index].paramId` key it only
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
  }
): (
  subBlocks: SubBlockRecord,
  blockType: string,
  canonicalModes?: CanonicalModeOverrides
) => SubBlockRecord {
  return (subBlocks, blockType, canonicalModes) => {
    const result = remapSubBlocks(subBlocks, resolve, {
      resolveMcpServerMeta: options?.resolveMcpServerMeta,
    })
    return clearDependentsOnRemap(result.subBlocks, blockType, result.remappedKeys, canonicalModes)
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
