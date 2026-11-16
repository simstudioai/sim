import { isRecordLike, omit } from '@sim/utils/object'
import type { BlockState } from '@sim/workflow-types/workflow'
import type { CanonicalModeOverrides } from '../catalog/canonical-index'
import type { CatalogBlock, CatalogSubBlock } from '../catalog/types'
import type { BlockKey, CanonicalParam, SubBlockId, Value } from '../model'
import { parseJsonContainer, setOwn } from '../records'
import { type CanonContext, report } from './context'
import { liftTools } from './tools'
import { liftResourceValue, toValue } from './values'

/**
 * Server-owned trigger runtime ids (triggers/constants.ts
 * `TRIGGER_RUNTIME_SUBBLOCK_IDS`). Materialize copies them from prev by id.
 */
const RUNTIME_SUBBLOCK_IDS = new Set(['webhookId', 'triggerPath', 'triggerConfig', 'triggerId'])
/** `{subBlockId}-tool-{index}-{paramId}` editor mirrors (synthetic-subblocks.ts:23-25). */
const SYNTHETIC_TOOL_SUBBLOCK = /-tool-\d+-/
/** Retired fields an earlier migration parked instead of deleting (subblock-migrations.ts:555-575). */
const PARKED_PREFIX = '_removed_'
/** Text types whose JSON-looking content is user text, never decoded. */
const NEVER_DECODED_TYPES = new Set(['code', 'long-input'])

/** Whether a stored subBlock id is excluded from params before any catalog lookup. */
export function isExcludedSubBlockId(id: string): boolean {
  return (
    RUNTIME_SUBBLOCK_IDS.has(id) || SYNTHETIC_TOOL_SUBBLOCK.test(id) || id.startsWith(PARKED_PREFIX)
  )
}

export interface ParamInputs {
  blockKey: BlockKey
  block: BlockState
  catalog: CatalogBlock | undefined
  overrides: CanonicalModeOverrides | undefined
  /** Stored subBlock id of the lifted branch list, skipped here. */
  branchSubBlockId?: SubBlockId
}

export interface ParamsResult {
  params: Record<SubBlockId, CanonicalParam>
  /** inputFormat ids by subBlock: field name → id (lock `items`). */
  items: Record<SubBlockId, Array<{ name: string; id: string }>>
}

/** The declaration a stored value was written through: the current surface's copy first. */
export function declarationFor(
  catalog: CatalogBlock | undefined,
  id: string,
  triggerMode: boolean
): CatalogSubBlock | undefined {
  const declarations = catalog?.subBlocks.filter((subBlock) => subBlock.id === id) ?? []
  const surface = triggerMode ? 'trigger' : 'action'
  return declarations.find((subBlock) => subBlock.surface === surface) ?? declarations[0]
}

/** Whether canonicalize decodes this subBlock's JSON text (structured or json-string storage). */
export function shouldDecode(declaration: CatalogSubBlock | undefined): boolean {
  if (!declaration || NEVER_DECODED_TYPES.has(declaration.type)) return false
  return declaration.structured !== undefined || declaration.storage === 'json-string'
}

/**
 * JSON text of a structured field, decoded. Only an object or array counts
 * as decoded, so a scalar-looking string stays the string it is. Blank text is the untouched
 * sentinel and stays as is; other text that does not parse is kept with
 * `W_CANON_UNDECODABLE_JSON`. The encoding is not recorded: the CWM is encoding-free and
 * materialize keeps prev's.
 */
function decodeStructured(
  raw: unknown,
  blockKey: BlockKey,
  param: string,
  context: CanonContext
): unknown {
  if (typeof raw !== 'string' || raw.trim() === '') return raw
  const parsed = parseJsonContainer(raw)
  if (parsed) return parsed
  report(context, {
    code: 'W_CANON_UNDECODABLE_JSON',
    severity: 'warning',
    message: `Stored ${param} is not a JSON list or object; kept as text`,
    blockKey,
    param,
  })
  return raw
}

/**
 * inputFormat fields: the editor's `collapsed` flag is dropped and each field's
 * `id` moves to the lock's `items`, keyed by field name. A field whose name is missing or shared
 * keeps its id inline, so nothing is lost.
 */
function liftInputFormat(
  list: unknown[],
  context: CanonContext
): { value: Value; items: Array<{ name: string; id: string }> } {
  const nameCounts = new Map<string, number>()
  for (const item of list) {
    if (isRecordLike(item) && typeof item.name === 'string') {
      nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1)
    }
  }
  const items: Array<{ name: string; id: string }> = []
  const value = list.map((item) => {
    if (!isRecordLike(item) || Object.hasOwn(item, '$sim')) return toValue(item, context)
    const rest = omit(item, ['collapsed'])
    if (
      typeof rest.id === 'string' &&
      typeof rest.name === 'string' &&
      nameCounts.get(rest.name) === 1
    ) {
      items.push({ name: rest.name, id: rest.id })
      return toValue(omit(rest, ['id']), context)
    }
    return toValue(rest, context)
  })
  return { value, items }
}

/**
 * Table rows (normalize.ts `sanitizeTableRows`): a `{ id, cells }` row loses its
 * client-generated `id`, and a row whose cells are all blank (the editor's starter row) is
 * dropped. Rows of any other shape carry data and pass through verbatim.
 */
function liftTableRows(list: unknown[], context: CanonContext): Value {
  const rows: Value[] = []
  for (const row of list) {
    if (!isRecordLike(row) || !isRecordLike(row.cells) || Object.hasOwn(row, '$sim')) {
      rows.push(toValue(row, context))
      continue
    }
    const blank = Object.values(row.cells).every(
      (cell) => cell === '' || cell === null || cell === undefined
    )
    if (blank) continue
    rows.push(toValue(omit(row, ['id']), context))
  }
  return rows
}

/**
 * Variable assignments (`variables-input`): each `variableId` becomes a `var` node keyed by the
 * variable's key (sites as remap-internal-ids.ts:58-80 walks them). An id naming no
 * variable stays an `unresolved` node with `W_CANON_UNRESOLVED_ID`.
 */
function liftVariableAssignments(
  value: unknown,
  blockKey: BlockKey,
  param: string,
  context: CanonContext
): Value {
  if (Array.isArray(value)) {
    return value.map((item) => liftVariableAssignments(item, blockKey, param, context))
  }
  if (!isRecordLike(value) || Object.hasOwn(value, '$sim')) return toValue(value, context)
  const result: Record<string, Value> = {}
  for (const [key, member] of Object.entries(value)) {
    if (member === undefined) continue
    if (key === 'variableId' && typeof member === 'string') {
      const variableKey = context.variableKeyById.get(member)
      if (variableKey !== undefined) {
        setOwn(result, key, { $sim: 'var', key: variableKey })
      } else {
        report(context, {
          code: 'W_CANON_UNRESOLVED_ID',
          severity: 'warning',
          message: `Variable assignment names unknown variable id "${member}"; kept verbatim`,
          blockKey,
          param,
        })
        setOwn(result, key, { $sim: 'unresolved', kind: 'var', id: member })
      }
      continue
    }
    setOwn(result, key, liftVariableAssignments(member, blockKey, param, context))
  }
  return result
}

/**
 * A block's params: every stored subBlock except runtime ids, synthetic
 * tool mirrors, parked keys, the lifted branch list, and a `null` value
 * (`''` is kept). Structured fields are decoded; selector values become resource nodes;
 * strings keep their text with reference prefixes normalized. The catalog's subBlock type wins
 * over the stored one, and a drift is reported.
 */
export function canonicalParams(inputs: ParamInputs, context: CanonContext): ParamsResult {
  const { blockKey, block, catalog, overrides } = inputs
  const params: Record<SubBlockId, CanonicalParam> = {}
  const items: ParamsResult['items'] = {}
  const triggerMode = block.triggerMode === true

  for (const [id, subBlock] of Object.entries(block.subBlocks ?? {})) {
    if (id === inputs.branchSubBlockId || isExcludedSubBlockId(id)) continue
    if (!isRecordLike(subBlock)) continue
    const raw = subBlock.value
    if (raw === null || raw === undefined) continue

    const declaration = declarationFor(catalog, id, triggerMode)
    if (typeof subBlock.id === 'string' && subBlock.id !== id) {
      report(context, {
        code: 'W_CANON_SUBBLOCK_TYPE_DRIFT',
        severity: 'warning',
        message: `Stored subBlock "${id}" carries id "${subBlock.id}"; the map key wins`,
        blockKey,
        param: id,
      })
    }
    if (
      catalog &&
      typeof subBlock.type === 'string' &&
      !catalog.subBlocks.some(
        (candidate) => candidate.id === id && candidate.type === subBlock.type
      ) &&
      catalog.subBlocks.some((candidate) => candidate.id === id)
    ) {
      report(context, {
        code: 'W_CANON_SUBBLOCK_TYPE_DRIFT',
        severity: 'warning',
        message: `Stored subBlock "${id}" has type "${subBlock.type}"; the catalog type "${declaration?.type}" wins`,
        blockKey,
        param: id,
      })
    }

    const decoded = shouldDecode(declaration) ? decodeStructured(raw, blockKey, id, context) : raw
    const location = { blockKey, param: id }

    if (declaration?.structured === 'tools' && Array.isArray(decoded)) {
      const tools = liftTools(decoded, overrides, blockKey, id, context)
      if (tools) {
        setOwn(params, id, { kind: 'tools', tools })
        continue
      }
    }
    let value: Value
    if (declaration?.structured === 'inputFormat' && Array.isArray(decoded)) {
      const lifted = liftInputFormat(decoded, context)
      value = lifted.value
      if (lifted.items.length > 0) setOwn(items, id, lifted.items)
    } else if (declaration?.structured === 'tableRows' && Array.isArray(decoded)) {
      value = liftTableRows(decoded, context)
    } else if (declaration?.structured === 'variables') {
      value = liftVariableAssignments(decoded, blockKey, id, context)
    } else if (declaration?.valueKind === 'resource' && declaration.resourceKind) {
      value =
        liftResourceValue(
          declaration.resourceKind,
          decoded,
          context,
          location,
          declaration.multiple
        ) ?? toValue(decoded, context)
    } else {
      value = toValue(decoded, context)
    }
    setOwn(params, id, { kind: 'value', value })
  }
  return { params, items }
}
