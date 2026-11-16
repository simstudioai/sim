import { isRecordLike, toRecord } from '@sim/utils/object'
import { type CanonicalModeOverrides, scopeCanonicalModesForTool } from '../catalog/canonical-index'
import type { CatalogSubBlock } from '../catalog/types'
import type { BlockKey, CanonicalTool, Json, Value } from '../model'
import { type CanonContext, catalogBlock } from './context'
import { effectiveModes } from './modes'
import { liftResourceId, liftResourceValue, toJson, toValue } from './values'

type ToolParamShape = 'string' | 'number' | 'boolean' | 'json'

const OBJECT_VALUED_TYPES = new Set([
  'checkbox-list',
  'file-upload',
  'grouped-checkbox-list',
  'table',
])
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

/** `getSubBlockValueShape` (tools/param-shape.ts): the shape a sub-block wrote. */
function subBlockShape(subBlock: CatalogSubBlock): ToolParamShape {
  if (subBlock.type === 'switch') return 'boolean'
  if (subBlock.type === 'slider') return 'number'
  if (OBJECT_VALUED_TYPES.has(subBlock.type)) return 'json'
  if (subBlock.multiple) return 'json'
  return 'string'
}

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

/** `decodeToolParamValue` (tools/param-shape.ts:185-214): total, keeps `''` and any misfit. */
function decodeToolParam(raw: unknown, shape: ToolParamShape): unknown {
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
    case 'json': {
      try {
        const parsed: unknown = JSON.parse(raw.trim())
        return typeof parsed === 'object' && parsed !== null ? parsed : raw
      } catch {
        return raw
      }
    }
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
  const block = catalogBlock(context, type)
  const toolId = typeof stored.toolId === 'string' ? stored.toolId : undefined
  const toolDeclaration =
    toolId && context.catalog.tools && Object.hasOwn(context.catalog.tools, toolId)
      ? context.catalog.tools[toolId]
      : undefined
  const location = { blockKey, param }

  const rawParams = toRecord(stored.params)
  const params: Record<string, Value> = {}
  for (const [key, raw] of Object.entries(rawParams)) {
    if (raw === undefined) continue
    const subBlock = block?.subBlocks.find(
      (candidate) => candidate.id === key || candidate.canonicalParamId === key
    )
    const shape = subBlock
      ? subBlockShape(subBlock)
      : toolDeclaration && Object.hasOwn(toolDeclaration.params, key)
        ? declaredShape(toolDeclaration.params[key].type)
        : 'string'
    const decoded = decodeToolParam(raw, shape)
    const lifted =
      subBlock?.valueKind === 'resource' && subBlock.resourceKind
        ? liftResourceValue(subBlock.resourceKind, decoded, context, location, subBlock.multiple)
        : undefined
    params[key] = lifted ?? toValue(decoded, context)
  }

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
    if (typeof value === 'string') tool[key] = value
    else if (value !== undefined) extra[key] = toJson(value)
  }
  if (typeof stored.usageControl === 'string' && USAGE_CONTROLS.has(stored.usageControl)) {
    tool.usageControl = stored.usageControl as CanonicalTool['usageControl']
  } else if (stored.usageControl !== undefined) {
    extra.usageControl = toJson(stored.usageControl)
  }
  if (stored.operationPolicy !== undefined) tool.operationPolicy = toJson(stored.operationPolicy)

  // s1 quirk 17: the DB copy wins over the snapshot at run time, so both are kept verbatim.
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

  // s1 quirk 24: `isExpanded` is editor state and is dropped.
  for (const [key, value] of Object.entries(stored)) {
    if (!MODELED_KEYS.has(key) && value !== undefined) extra[key] = toJson(value)
  }
  if (Object.keys(extra).length > 0) tool.extra = extra
  return tool
}

function definedModes(overrides: CanonicalModeOverrides | undefined): CanonicalTool['modes'] {
  const modes: CanonicalTool['modes'] = {}
  for (const [id, mode] of Object.entries(overrides ?? {})) {
    if (mode) modes[id] = mode
  }
  return modes
}

/**
 * Lifts a `tool-input` list (s1 canonicalize step 5, quirks 3, 9, 17, 24). Each entry's modes
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
