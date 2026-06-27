import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
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
import type { ParsedStoredTool } from '@/lib/workflows/tool-input/types'
import { remapForkFileUploadValue } from '@/lib/workspaces/fork/remap/remap-files'
import { getBlock } from '@/blocks/registry'

/**
 * Resource kinds the fork remapper rewrites across workspaces, derived from the
 * wire contract so the union can't drift from `forkRemapKindSchema`. `workflow`,
 * `mcp-tool`, and the service-specific `selector-resource` kinds are deliberately
 * excluded: workflow references are remapped via the workflow identity map, and
 * MCP tool / selector ids are not workspace-local so they carry over unchanged.
 */
export type ForkRemapKind = z.infer<typeof forkRemapKindSchema>

const logger = createLogger('WorkspaceForkRemapReferences')

const REQUIRED_KINDS = new Set<ForkRemapKind>(['credential', 'env-var'])

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
  table: 'table',
  'mcp-server': 'mcp-server',
}
// `file` and `knowledge-document` are intentionally excluded from the generic
// registry path. `file-upload` (workspace files) is remapped by storage key via
// `remapForkFileUploadValue`; `file-selector` (external provider file ids,
// credential-scoped) carries over unchanged; `document-selector` is cleared by the
// `dependsOn` rule (clearDependentsOnRemap) when its parent knowledge base is remapped.

/** Matches `{{ENV_KEY}}` references inside subblock values; shared with cascade detection. */
export const ENV_REF_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

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
      // provider id) carries over unchanged.
      if (config.type !== 'file-upload') continue
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
          return [
            {
              ...tool,
              params: { ...tool.params, serverId: target },
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
 * Rewrite the server id embedded in an `mcp-tool-selector` value
 * (`<prefix><serverId>-<toolName>`) when the sibling MCP server was remapped.
 * Server ids are UUIDs, so substring replacement is unambiguous. Without this the
 * tool reference keeps the old server id and resolves to a malformed tool id at
 * runtime after the server is remapped.
 */
export function rewriteMcpToolSelectorValue(
  value: unknown,
  serverRemaps: Map<string, string>
): unknown {
  if (typeof value !== 'string' || value.length === 0 || serverRemaps.size === 0) return value
  let next = value
  for (const [sourceId, targetId] of serverRemaps) {
    if (next.includes(sourceId)) next = next.split(sourceId).join(targetId)
  }
  return next
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
  context?: { blockId?: string; blockName?: string }
): RemapSubBlocksResult {
  // create (initial fork): clear/drop refs that weren't copied; leave `{{ENV}}` by
  // name. promote: keep unresolved refs + record them (so the mapping UI can surface
  // and block on required credentials) and rewrite `{{ENV}}`.
  const clearUnresolved = mode === 'create'
  const result: SubBlockRecord = {}
  const references = new Map<string, ForkReference>()
  const unmapped = new Map<string, ForkReference>()
  const remappedKeys = new Set<string>()
  // Source→target ids for any remapped MCP server, applied to sibling
  // `mcp-tool-selector` values (which embed the server id) in a post-pass.
  const mcpServerRemaps = new Map<string, string>()

  const recordReference = (key: string, reference: ForkReference, mapped: boolean) => {
    if (mode !== 'promote') return
    references.set(key, reference)
    if (!mapped) unmapped.set(key, reference)
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
        recordReference(`${forkKind}:${ref.rawValue}`, reference, mapped)
        if (mapped) {
          if (forkKind === 'mcp-server' && target !== ref.rawValue) {
            mcpServerRemaps.set(ref.rawValue, target)
          }
          if (target !== ref.rawValue) {
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
      // Workspace-file refs don't sync on promote (the target lacks the source's
      // blob); clear them rather than carry a cross-workspace key. On fork, the
      // resolver returns the copied key. `file-selector` (external) is untouched.
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
          ? remapForkToolInputValue(value, resolve, { clearUnresolved, record })
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

  if (mcpServerRemaps.size > 0) {
    for (const [subBlockKey, subBlock] of Object.entries(result)) {
      if (!isRecord(subBlock) || subBlock.type !== 'mcp-tool-selector') continue
      const rewritten = rewriteMcpToolSelectorValue(subBlock.value, mcpServerRemaps)
      if (rewritten !== subBlock.value) result[subBlockKey] = { ...subBlock, value: rewritten }
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
 * Slack channel, a sheet tab) never carries a stale id into the target. Reuses
 * the search-replace dependent-clear walk (canonical-pair aware, transitive over
 * `dependsOn` chains) so fork/promote and in-editor search-replace clear
 * identically. Children of an unchanged parent are preserved; a no-op for
 * unknown block types or when nothing was remapped.
 */
export function clearDependentsOnRemap(
  subBlocks: SubBlockRecord,
  blockType: string,
  remappedKeys: ReadonlySet<string>
): SubBlockRecord {
  if (remappedKeys.size === 0) return subBlocks
  const config = getBlock(blockType)
  if (!config) return subBlocks

  const toClear = new Set<string>()
  for (const key of remappedKeys) {
    for (const clear of getWorkflowSearchDependentClears(config.subBlocks, key)) {
      if (!remappedKeys.has(clear.subBlockId)) toClear.add(clear.subBlockId)
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
 * Promote-mode remap (keep + record unmapped references). Thin wrapper over
 * {@link remapForkSubBlocks}; also used by the reference scan.
 */
export function remapSubBlocks(
  subBlocks: SubBlockRecord,
  resolve: ForkReferenceResolver,
  context?: { blockId?: string; blockName?: string }
): RemapSubBlocksResult {
  return remapForkSubBlocks(subBlocks, resolve, 'promote', context)
}

/** A `copyWorkflowStateIntoTarget` subBlock transform that rewrites references via the resolver. */
export function createForkSubBlockTransform(
  resolve: ForkReferenceResolver
): (subBlocks: SubBlockRecord, blockType: string) => SubBlockRecord {
  return (subBlocks, blockType) => {
    const result = remapSubBlocks(subBlocks, resolve)
    return clearDependentsOnRemap(result.subBlocks, blockType, result.remappedKeys)
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
  blocks: Array<{ id: string; name: string; subBlocks: unknown }>,
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
