import { isRecordLike } from '@sim/utils/object'
import { mcpBinding, mcpToolId } from '../agent-tools'
import { shouldDecode } from '../canonicalize/params'
import { decodeToolParam, toolParamDeclaration } from '../canonicalize/tools'
import type { CatalogSubBlock } from '../catalog/types'
import type { LockItem } from '../lock'
import type { BlockKey, CanonicalParam, CanonicalTool, SubBlockId } from '../model'
import { deepEqual, getOwn, parseStoredList, setOwn } from '../records'
import { structuredCodec } from '../structured'
import type { MaterializeContext } from './context'
import { unliftValue } from './values'

/** What encoding one param needs besides the value itself. */
export interface ParamSite {
  blockKey: BlockKey
  param: SubBlockId
  declaration: CatalogSubBlock | undefined
  /** The stored value this param replaces (`undefined` when the subBlock is new). */
  prevRaw: unknown
  /** The prev param, decoded, when this block continues a prev block. */
  prevParam: CanonicalParam | undefined
  /** Ids to give inputFormat fields, by name, in preference order (lock first, then prev). */
  itemIds: LockItem[]
  /** Branch lists are always stored as text: the canvas reads them with `toString()`. */
  forceText: boolean
}

/** Whether prev stored text, or, with no prev value, the catalog `storage` is `json-string`. */
function storesAsText(site: ParamSite): boolean {
  return site.prevRaw !== undefined && site.prevRaw !== null
    ? typeof site.prevRaw === 'string'
    : site.declaration?.storage === 'json-string'
}

/**
 * The encoding a decoded value is written in: JSON text when the site forces text, or when the
 * field is one canonicalize decodes and {@link storesAsText}; native otherwise. Scalars are always
 * native, and a field canonicalize never decodes keeps a structured value native so it reads back
 * unchanged.
 */
function encodeStorage(json: unknown, site: ParamSite): unknown {
  if (typeof json !== 'object' || json === null) return json
  if (site.forceText) return JSON.stringify(json)
  if (!shouldDecode(site.declaration)) return json
  return storesAsText(site) ? JSON.stringify(json) : json
}

/**
 * A tool param in `StoredTool.params` form: text through `encodeToolParamValue`
 * whenever `decodeToolParamValue` reads it back to the same value,
 * else the native value (a `null`, or a value that does not fit the declared shape).
 */
function encodeToolParam(json: unknown, shape: ReturnType<typeof toolParamDeclaration>['shape']) {
  if (typeof json === 'string') return json
  const text = json === null || json === undefined ? '' : JSON.stringify(json)
  return deepEqual(decodeToolParam(text, shape), json) ? text : json
}

function encodeTool(
  tool: CanonicalTool,
  prev: { raw: Record<string, unknown>; canonical: CanonicalTool } | undefined,
  site: ParamSite,
  context: MaterializeContext
): Record<string, unknown> {
  const location = { blockKey: site.blockKey, param: site.param }
  const stored: Record<string, unknown> = { type: tool.type }
  if (tool.title !== undefined) stored.title = tool.title
  if (tool.toolId !== undefined) stored.toolId = tool.toolId
  if (tool.operation !== undefined) stored.operation = tool.operation

  const prevParams = prev && isRecordLike(prev.raw.params) ? prev.raw.params : undefined
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(tool.params)) {
    if (
      prev &&
      prevParams &&
      Object.hasOwn(prevParams, key) &&
      deepEqual(getOwn(prev.canonical.params, key), value)
    ) {
      setOwn(params, key, prevParams[key])
      continue
    }
    const { shape } = toolParamDeclaration(context.catalog, tool.type, key)
    setOwn(params, key, encodeToolParam(unliftValue(value, context, location), shape))
  }
  stored.params = params
  const binding = tool.toolId === undefined ? mcpBinding(tool.type, params) : null
  // Canonicalize drops the toolId the binding derives, since it embeds the server's id.
  if (binding) stored.toolId = mcpToolId(binding.serverId, binding.toolName)
  if (prev && prev.raw.isExpanded !== undefined) stored.isExpanded = prev.raw.isExpanded

  if (tool.usageControl !== undefined) stored.usageControl = tool.usageControl
  if (tool.usageControlExpression !== undefined) {
    stored.usageControlExpression = tool.usageControlExpression
  }
  if (tool.customTool?.ref)
    stored.customToolId = unliftValue(tool.customTool.ref, context, location)
  if (tool.customTool?.snapshot) {
    stored.schema = tool.customTool.snapshot.schema
    stored.code = tool.customTool.snapshot.code
  }
  if (tool.operationPolicy !== undefined) stored.operationPolicy = tool.operationPolicy
  for (const [key, value] of Object.entries(tool.extra ?? {})) setOwn(stored, key, value)
  return stored
}

/**
 * For each compiled tool, the index of the prev tool it continues: the first unused prev tool
 * canonical-equal to it, else the unused prev tool of the same type at the same position. A tool
 * that moved keeps its stored extras (`isExpanded`) and its explicit modes.
 */
export function matchPrevTools(
  tools: CanonicalTool[],
  prevTools: CanonicalTool[]
): Array<number | undefined> {
  const used = new Set<number>()
  const matches: Array<number | undefined> = tools.map((tool) => {
    const index = prevTools.findIndex((prev, i) => !used.has(i) && deepEqual(prev, tool))
    if (index === -1) return undefined
    used.add(index)
    return index
  })
  return matches.map((match, index) => {
    if (match !== undefined) return match
    if (used.has(index) || prevTools[index]?.type !== tools[index].type) return undefined
    used.add(index)
    return index
  })
}

/**
 * A tool-input list. A tool canonical-equal to the prev tool it continues keeps prev's stored
 * object; others are re-encoded, keeping prev's raw text for each param whose decoded value is
 * unchanged. The list is text when {@link storesAsText}.
 */
function encodeTools(tools: CanonicalTool[], site: ParamSite, context: MaterializeContext) {
  const prevList = parseStoredList(site.prevRaw) ?? []
  const prevTools = site.prevParam?.kind === 'tools' ? site.prevParam.tools : []
  const matches = matchPrevTools(tools, prevTools)
  const list = tools.map((tool, index) => {
    const match = matches[index]
    const raw = match !== undefined ? prevList[match] : undefined
    const canonical = match !== undefined ? prevTools[match] : undefined
    if (!isRecordLike(raw) || !canonical) return encodeTool(tool, undefined, site, context)
    if (deepEqual(tool, canonical)) return raw
    return encodeTool(tool, { raw, canonical }, site, context)
  })
  return storesAsText(site) ? JSON.stringify(list) : list
}

/** The stored value of one changed param. */
export function encodeParam(
  param: CanonicalParam,
  site: ParamSite,
  context: MaterializeContext
): unknown {
  if (param.kind === 'tools') return encodeTools(param.tools, site, context)
  const codec = structuredCodec(site.declaration)
  const json = codec
    ? codec.encode(param.value, site, context)
    : unliftValue(param.value, context, { blockKey: site.blockKey, param: site.param })
  return encodeStorage(json, site)
}
