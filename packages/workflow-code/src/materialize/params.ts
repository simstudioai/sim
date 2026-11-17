import { isRecordLike } from '@sim/utils/object'
import { mcpBinding, mcpToolId } from '../agent-tools'
import { shouldDecode, storedSkillEntry, uniqueFieldNames } from '../canonicalize/params'
import { decodeToolParam, toolParamDeclaration } from '../canonicalize/tools'
import type { CatalogSubBlock } from '../catalog/types'
import type { LockItem } from '../lock'
import {
  type BlockKey,
  type CanonicalParam,
  type CanonicalTool,
  isSimNode,
  type SubBlockId,
  type Value,
} from '../model'
import { deepEqual, getOwn, parseStoredList, setOwn } from '../records'
import type { MaterializeContext } from './context'
import { unliftValue } from './values'

/** What encoding one param needs besides the value itself. */
interface ParamSite {
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
 * Puts inputFormat field ids back: canonicalize moved the id of every field whose name and id are
 * both unique to the lock, so each such field takes the lock's id for its name, then prev's, else a
 * new one. Fields that kept their id inline are untouched. The editor's `collapsed`
 * flag is carried over from the prev field with the same id.
 */
function restoreInputFormatIds(list: unknown[], site: ParamSite, context: MaterializeContext) {
  const unique = uniqueFieldNames(list)
  const prevById = new Map<string, Record<string, unknown>>()
  for (const item of parseStoredList(site.prevRaw) ?? []) {
    if (isRecordLike(item) && typeof item.id === 'string') prevById.set(item.id, item)
  }
  const used = new Set<string>()
  return list.map((item) => {
    if (!isRecordLike(item) || typeof item.name !== 'string' || item.id !== undefined) return item
    if (!unique.has(item.name)) return item
    const name = item.name
    const known = site.itemIds.find((entry) => entry.name === name && !used.has(entry.id))
    const id = known?.id ?? context.hooks.newId()
    used.add(id)
    const restored: Record<string, unknown> = { id, ...item }
    const prevItem = prevById.get(id)
    if (prevItem && prevItem.collapsed !== undefined) restored.collapsed = prevItem.collapsed
    return restored
  })
}

/**
 * Puts table row ids back: canonicalize dropped each `{ id, cells }` row's id, so a row
 * takes the id of the first unused prev row with the same cells, else a new one.
 */
function restoreRowIds(list: unknown[], site: ParamSite, context: MaterializeContext) {
  const prevRows = (parseStoredList(site.prevRaw) ?? []).filter(
    (row): row is Record<string, unknown> & { id: string } =>
      isRecordLike(row) && typeof row.id === 'string' && isRecordLike(row.cells)
  )
  const used = new Set<string>()
  return list.map((row) => {
    if (!isRecordLike(row) || !isRecordLike(row.cells) || row.id !== undefined) return row
    const cells = row.cells
    const match = prevRows.find((prev) => !used.has(prev.id) && deepEqual(prev.cells, cells))
    const id = match?.id ?? context.hooks.newId()
    used.add(id)
    return { id, ...row }
  })
}

/**
 * Agent skills: each `skill` node is written as `{ skillId, name }`. The name is prev's for the
 * same skill (so an unchanged entry keeps its bytes), else the skill's current name from the
 * resolver, else its key. Every other entry is written as itself.
 */
function encodeSkills(list: Value[], site: ParamSite, context: MaterializeContext): unknown[] {
  const location = { blockKey: site.blockKey, param: site.param }
  const prevNames = new Map<string, string>()
  for (const item of parseStoredList(site.prevRaw) ?? []) {
    const entry = storedSkillEntry(item)
    if (entry && !prevNames.has(entry.skillId)) prevNames.set(entry.skillId, entry.name)
  }
  return list.map((item) => {
    const skillId = unliftValue(item, context, location)
    const isSkill = isSimNode(item) && item.$sim === 'resource' && item.kind === 'skill'
    if (!isSkill || typeof skillId !== 'string') return skillId
    const name = prevNames.get(skillId) ?? context.resources?.nameOf?.('skill', skillId) ?? item.key
    return { skillId, name }
  })
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
  let json =
    site.declaration?.structured === 'skills' && Array.isArray(param.value)
      ? encodeSkills(param.value, site, context)
      : unliftValue(param.value, context, { blockKey: site.blockKey, param: site.param })
  if (Array.isArray(json) && site.declaration?.structured === 'inputFormat') {
    json = restoreInputFormatIds(json, site, context)
  } else if (Array.isArray(json) && site.declaration?.structured === 'tableRows') {
    json = restoreRowIds(json, site, context)
  }
  return encodeStorage(json, site)
}
