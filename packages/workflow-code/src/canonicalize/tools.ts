import { isRecordLike, toRecord } from '@sim/utils/object'
import { mcpBinding, mcpToolId } from '../agent-tools'
import { type CanonicalModeOverrides, scopeCanonicalModesForTool } from '../catalog/canonical-index'
import type { BlockCatalog, CatalogSubBlock } from '../catalog/types'
import { catalogBlock, catalogTool } from '../catalog/view'
import type { BlockKey, CanonicalTool, Json, Value } from '../model'
import { parseJsonContainer, setOwn } from '../records'
import type { CanonContext } from './context'
import { effectiveModes } from './modes'
import { liftResourceId, liftResourceValue, toJson, toValue } from './values'

export type ToolParamShape = 'string' | 'number' | 'boolean' | 'json'

const USAGE_CONTROLS = new Set(['auto', 'force', 'none'])

/** Stored tool keys with a typed model field; anything else is kept under `extra`. */
const MODELED_KEYS = new Set([
  'type',
  'operation',
  'toolId',
  'title',
  'params',
  'usageControl',
  'usageControlExpression',
  'customToolId',
  'schema',
  'code',
  'operationPolicy',
  'isExpanded',
])

/** `getToolParamValueShape` (tools/param-shape.ts): the shape a tool declaration implies. */
function declaredShape(type: string | undefined): ToolParamShape {
  switch (type) {
    case 'boolean':
      return 'boolean'
    case 'number':
      return 'number'
    case 'json':
    case 'array':
    case 'object':
    case 'file':
    case 'file[]':
      return 'json'
    default:
      return 'string'
  }
}

/**
 * The declaration and value shape of one stored tool param: the tool block's subBlock (by id or
 * canonical id) wins, then the tool's declared param type, else `string`.
 */
export function toolParamDeclaration(
  catalog: BlockCatalog,
  tool: { type: string; toolId?: string },
  key: string
): { subBlock: CatalogSubBlock | undefined; shape: ToolParamShape } {
  const subBlock = catalogBlock(catalog, tool.type)?.subBlocks.find(
    (candidate) => candidate.id === key || candidate.canonicalParamId === key
  )
  if (subBlock) return { subBlock, shape: subBlock.valueShape ?? 'string' }
  const declaration = tool.toolId ? catalogTool(catalog, tool.toolId) : undefined
  return {
    subBlock: undefined,
    shape:
      declaration && Object.hasOwn(declaration.params, key)
        ? declaredShape(declaration.params[key].type)
        : 'string',
  }
}

/** `decodeToolParamValue` (tools/param-shape.ts:185-214): total, keeps `''` and any misfit. */
export function decodeToolParam(raw: unknown, shape: ToolParamShape): unknown {
  if (typeof raw !== 'string' || raw === '') return raw
  switch (shape) {
    case 'boolean': {
      const normalized = raw.trim().toLowerCase()
      if (normalized === 'true') return true
      if (normalized === 'false') return false
      return raw
    }
    case 'number': {
      const parsed = Number(raw.trim())
      return Number.isFinite(parsed) ? parsed : raw
    }
    case 'json':
      return parseJsonContainer(raw) ?? raw
    default:
      return raw
  }
}

/** Whether a stored entry can be represented as a `CanonicalTool` at all. */
function isLiftableTool(stored: unknown): stored is Record<string, unknown> & { type: string } {
  return (
    isRecordLike(stored) &&
    typeof stored.type === 'string' &&
    (stored.params === undefined || isRecordLike(stored.params))
  )
}

function liftTool(
  stored: Record<string, unknown> & { type: string },
  index: number,
  overrides: CanonicalModeOverrides | undefined,
  blockKey: BlockKey,
  param: string,
  context: CanonContext
): CanonicalTool {
  const type = stored.type
  const block = catalogBlock(context.catalog, type)
  const toolId = typeof stored.toolId === 'string' ? stored.toolId : undefined
  const location = { blockKey, param }

  const rawParams = toRecord(stored.params)
  const params: Record<string, Value> = {}
  for (const [key, raw] of Object.entries(rawParams)) {
    if (raw === undefined) continue
    const { subBlock, shape } = toolParamDeclaration(context.catalog, { type, toolId }, key)
    const decoded = decodeToolParam(raw, shape)
    const lifted =
      subBlock?.valueKind === 'resource' && subBlock.resourceKind
        ? liftResourceValue(subBlock.resourceKind, decoded, context, location, subBlock.multiple)
        : undefined
    setOwn(params, key, lifted ?? toValue(decoded, context))
  }
  const binding = mcpBinding(type, rawParams)
  if (binding) params.serverId = liftResourceId('mcp-server', binding.serverId, context, location)

  const explicit = scopeCanonicalModesForTool(overrides, index, type)
  const tool: CanonicalTool = {
    type,
    params,
    modes: block
      ? effectiveModes(block, false, rawParams, explicit, false)
      : definedModes(explicit),
  }
  const extra: Record<string, Json> = {}

  for (const key of ['operation', 'toolId', 'title', 'usageControlExpression'] as const) {
    const value = stored[key]
    if (key === 'toolId' && binding && value === mcpToolId(binding.serverId, binding.toolName)) {
      continue
    }
    if (typeof value === 'string') tool[key] = value
    else if (value !== undefined) extra[key] = toJson(value)
  }
  if (typeof stored.usageControl === 'string' && USAGE_CONTROLS.has(stored.usageControl)) {
    tool.usageControl = stored.usageControl as CanonicalTool['usageControl']
  } else if (stored.usageControl !== undefined) {
    extra.usageControl = toJson(stored.usageControl)
  }
  if (stored.operationPolicy !== undefined) tool.operationPolicy = toJson(stored.operationPolicy)

  // The DB copy wins over the snapshot at run time, so both are kept verbatim.
  const customTool: NonNullable<CanonicalTool['customTool']> = {}
  if (typeof stored.customToolId === 'string' && stored.customToolId !== '') {
    customTool.ref = liftResourceId('custom-tool', stored.customToolId, context, location)
  } else if (stored.customToolId !== undefined) {
    extra.customToolId = toJson(stored.customToolId)
  }
  if (stored.schema !== undefined && typeof stored.code === 'string') {
    customTool.snapshot = { schema: toJson(stored.schema), code: stored.code }
  } else {
    if (stored.schema !== undefined) extra.schema = toJson(stored.schema)
    if (stored.code !== undefined) extra.code = toJson(stored.code)
  }
  if (customTool.ref || customTool.snapshot) tool.customTool = customTool

  // `isExpanded` is editor state and is dropped.
  for (const [key, value] of Object.entries(stored)) {
    if (!MODELED_KEYS.has(key) && value !== undefined) setOwn(extra, key, toJson(value))
  }
  if (Object.keys(extra).length > 0) tool.extra = extra
  return tool
}

function definedModes(overrides: CanonicalModeOverrides | undefined): CanonicalTool['modes'] {
  const modes: CanonicalTool['modes'] = {}
  for (const [id, mode] of Object.entries(overrides ?? {})) {
    if (mode) setOwn(modes, id, mode)
  }
  return modes
}

/**
 * Lifts a `tool-input` list. Each entry's modes
 * come from its index-scoped `${i}:cid` overrides layered over legacy `${type}:cid` ones
 * (`scopeCanonicalModesForTool`), resolved to an effective mode for every pair of the tool's
 * block. Params are decoded with `decodeToolParamValue`'s shape rules. Returns `null` when any
 * entry is not a typed object, so the caller keeps the list verbatim as a value.
 */
export function liftTools(
  list: unknown[],
  overrides: CanonicalModeOverrides | undefined,
  blockKey: BlockKey,
  param: string,
  context: CanonContext
): CanonicalTool[] | null {
  if (!list.every(isLiftableTool)) return null
  return list.map((stored, index) => liftTool(stored, index, overrides, blockKey, param, context))
}
