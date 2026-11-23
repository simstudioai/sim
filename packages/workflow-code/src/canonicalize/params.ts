import { isRecordLike } from '@sim/utils/object'
import type { BlockState } from '@sim/workflow-types/workflow'
import type { CanonicalModeOverrides } from '../catalog/canonical-index'
import { isConditionClause } from '../catalog/conditions'
import type { CatalogBlock, CatalogCondition, CatalogSubBlock } from '../catalog/types'
import { declarationsOf } from '../catalog/view'
import { diagnostic } from '../diagnostics/factory'
import type { BlockKey, CanonicalParam, SubBlockId, Value } from '../model'
import { parseJsonContainer, setOwn } from '../records'
import { structuredCodec } from '../structured'
import type { CanonContext } from './context'
import { liftTools } from './tools'
import { liftResourceValue, toValue } from './values'

/**
 * Server-owned trigger runtime ids (triggers/constants.ts
 * `TRIGGER_RUNTIME_SUBBLOCK_IDS`). Materialize copies them from prev by id.
 */
const RUNTIME_SUBBLOCK_IDS = new Set(['webhookId', 'triggerPath', 'triggerConfig', 'triggerId'])
/** `{subBlockId}-tool-{index}-{paramId}` editor mirrors (`buildToolSubBlockId`). */
const SYNTHETIC_TOOL_SUBBLOCK = /-tool-\d+-/
/** Retired fields an earlier migration parked instead of deleting (`migrateBlockSubblockIds`). */
const PARKED_PREFIX = '_removed_'

/** Whether a stored subBlock id is excluded from params before any catalog lookup. */
export function isExcludedSubBlockId(id: string): boolean {
  return (
    RUNTIME_SUBBLOCK_IDS.has(id) || SYNTHETIC_TOOL_SUBBLOCK.test(id) || id.startsWith(PARKED_PREFIX)
  )
}

interface ParamInputs {
  blockKey: BlockKey
  block: BlockState
  catalog: CatalogBlock | undefined
  overrides: CanonicalModeOverrides | undefined
  /** Stored subBlock id of the lifted branch list, skipped here. */
  branchSubBlockId?: SubBlockId
}

interface ParamsResult {
  params: Record<SubBlockId, CanonicalParam>
  /** inputFormat ids by subBlock: field name → id (lock `items`). */
  items: Record<SubBlockId, Array<{ name: string; id: string }>>
}

/** The declaration a stored value was written through: the current surface's copy first. */
export function surfaceDeclaration(
  catalog: CatalogBlock | undefined,
  id: string,
  triggerMode: boolean
): CatalogSubBlock | undefined {
  const declarations = catalog ? declarationsOf(catalog, id) : []
  const surface = triggerMode ? 'trigger' : 'action'
  return declarations.find((subBlock) => subBlock.surface === surface) ?? declarations[0]
}

/** Whether canonicalize decodes this subBlock's JSON text (structured or json-string storage). */
export function shouldDecode(declaration: CatalogSubBlock | undefined): boolean {
  if (!declaration || declaration.neverDecoded === true) return false
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
  context.diagnostics.push(
    diagnostic(
      'W_CANON_UNDECODABLE_JSON',
      `Stored ${param} is not a JSON list or object; kept as text`,
      {
        blockKey,
        param,
      }
    )
  )
  return raw
}

/** Decimal text as the old slider defaults stored it (`'0.7'`, `'1.0'`): no sign tricks or exponents. */
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/

/** Fields another field's condition reads, per catalog block. */
const conditionedFieldsByBlock = new WeakMap<CatalogBlock, ReadonlySet<SubBlockId>>()

function conditionedFields(catalog: CatalogBlock): ReadonlySet<SubBlockId> {
  const cached = conditionedFieldsByBlock.get(catalog)
  if (cached) return cached
  const fields = new Set<SubBlockId>()
  const read = (clause: CatalogCondition | boolean | undefined) => {
    if (!isConditionClause(clause)) return
    fields.add(clause.field)
    if (clause.and) fields.add(clause.and.field)
  }
  for (const subBlock of catalog.subBlocks) {
    read(subBlock.condition)
    read(subBlock.required)
    for (const clause of Object.values(subBlock.visibleWhen ?? {})) read(clause)
  }
  conditionedFieldsByBlock.set(catalog, fields)
  return fields
}

/**
 * A switch's or slider's legacy text read as the boolean or number it spells. Registry defaults
 * once seeded `'true'`/`'false'` and `'0.7'`, and stored workflows still hold them. Like JSON text in a structured field this is an
 * encoding, not a value: the CWM holds the typed value and materialize keeps prev's raw text while
 * the value is unchanged. A field another field's condition reads keeps its text, because
 * visibility compares strictly and the editor tells `'true'` from `true` there.
 */
function decodeLegacyScalar(
  raw: unknown,
  declaration: CatalogSubBlock | undefined,
  catalog: CatalogBlock | undefined
): unknown {
  if (typeof raw !== 'string' || !declaration || !catalog) return raw
  if (declaration.valueKind === 'boolean') {
    if (raw !== 'true' && raw !== 'false') return raw
  } else if (declaration.valueKind !== 'number' || !NUMERIC_TEXT.test(raw)) {
    return raw
  }
  if (conditionedFields(catalog).has(declaration.id)) return raw
  return declaration.valueKind === 'boolean' ? raw === 'true' : Number(raw)
}

/**
 * A block's params: every stored subBlock except runtime ids, synthetic
 * tool mirrors, parked keys, the lifted branch list, and a `null` value
 * (`''` is kept). Structured fields are decoded, and so is a switch's or slider's legacy text
 * ({@link decodeLegacyScalar}); selector values become resource nodes;
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

    const declaration = surfaceDeclaration(catalog, id, triggerMode)
    if (typeof subBlock.id === 'string' && subBlock.id !== id) {
      context.diagnostics.push(
        diagnostic(
          'W_CANON_SUBBLOCK_TYPE_DRIFT',
          `Stored subBlock "${id}" carries id "${subBlock.id}"; the map key wins`,
          {
            blockKey,
            param: id,
          }
        )
      )
    }
    if (
      catalog &&
      typeof subBlock.type === 'string' &&
      declarationsOf(catalog, id).length > 0 &&
      !declarationsOf(catalog, id).some((candidate) => candidate.type === subBlock.type)
    ) {
      context.diagnostics.push(
        diagnostic(
          'W_CANON_SUBBLOCK_TYPE_DRIFT',
          `Stored subBlock "${id}" has type "${subBlock.type}"; the catalog type "${declaration?.type}" wins`,
          {
            blockKey,
            param: id,
          }
        )
      )
    }

    const decoded = shouldDecode(declaration)
      ? decodeStructured(raw, blockKey, id, context)
      : decodeLegacyScalar(raw, declaration, catalog)
    const location = { blockKey, param: id }

    if (declaration?.structured === 'tools' && Array.isArray(decoded)) {
      const tools = liftTools(decoded, overrides, blockKey, id, context)
      if (tools) {
        setOwn(params, id, { kind: 'tools', tools })
        continue
      }
    }
    const lifted = structuredCodec(declaration)?.lift(decoded, {
      blockKey,
      param: id,
      overrides,
      context,
    })
    if (lifted) {
      setOwn(params, id, lifted.param)
      if (lifted.items) setOwn(items, id, lifted.items)
      continue
    }
    let value: Value
    if (declaration?.valueKind === 'resource' && declaration.resourceKind) {
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
