import { createLogger } from '@sim/logger'
import type { SubBlockType } from '@sim/workflow-types/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { ParameterVisibility } from '@/tools/types'

/**
 * The single source of truth for "what shape does this tool param's value have, and
 * which sub-block collects it".
 *
 * Deliberately a leaf module alongside `@/tools/merge-params`, under the same import
 * discipline: nothing here may import `@/tools/utils`, `@/tools/registry`,
 * `@/tools/params`, or `@/tools/metadata`. Those pull the tool registry (or its 4MB
 * generated metadata) into the graph of every caller, and this module is imported by
 * client components, the executor, and the search indexer alike. All inputs arrive as
 * arguments; nothing is looked up.
 *
 * Before this existed the same two questions were answered independently in four
 * places (`tool-input`'s `renderParameterInput`, `getToolParametersConfig`'s
 * `uiComponent`, the search indexer's `getFallbackToolParamType`, and
 * `mcp-dynamic-args`'s `getInputType`), which is why a `boolean` tool param could
 * render as a switch on one surface and a text box on another.
 */

const logger = createLogger('ToolParamShape')

/**
 * How a tool param's value is represented once it leaves the sub-block store.
 *
 * `StoredTool.params` is `Record<string, string>`, so every value crossing that
 * boundary is stringified. This is the type information needed to reverse that.
 */
export type ToolParamValueShape = 'string' | 'number' | 'boolean' | 'json'

/**
 * The sub-block that collects a value of the given type.
 *
 * Shared by the two places a value type has to become a control: a tool param the block
 * does not surface as a sub-block of its own, and a custom block's Start input field.
 * Those vocabularies overlap entirely, and the two maps have to agree — a `boolean`
 * cannot be a switch on one path and a text box on the other.
 *
 * Each entry is the simplest control whose required configuration the declaration
 * actually carries. `dropdown` (needs `options`), `slider` (needs `min`/`max`), the
 * `*-selector` family (needs `selectorKey`), `oauth-input` (needs `serviceId` and
 * `requiredScopes`), and `table` (needs `columns`) are all deliberately absent: a
 * `ToolConfig` param declaration has no field to supply them, and synthesizing one
 * without its configuration produces a control that silently misbehaves — a bounded
 * slider invents a 0-100 range and pre-fills a value the user never chose.
 */
const SUBBLOCK_TYPE_BY_VALUE_TYPE: Record<string, SubBlockType> = {
  string: 'short-input',
  number: 'short-input',
  boolean: 'switch',
  json: 'code',
  array: 'code',
  object: 'code',
  file: 'file-upload',
  'file[]': 'file-upload',
  any: 'short-input',
}

/** Sub-block types whose store value is an object or array rather than a scalar. */
const OBJECT_VALUED_SUBBLOCK_TYPES = new Set<SubBlockType>([
  'checkbox-list',
  'file-upload',
  'grouped-checkbox-list',
  'table',
])

/**
 * The sub-block type that collects a declared value type.
 *
 * Falls back to `short-input` for an unrecognized declaration, so an unknown type
 * degrades to a plain text field rather than rendering nothing.
 */
export function subBlockTypeForValueType(valueType: string | undefined): SubBlockType {
  return (valueType && SUBBLOCK_TYPE_BY_VALUE_TYPE[valueType]) || 'short-input'
}

/**
 * The value shape a sub-block writes to the store.
 *
 * This is the primary key for decoding, because it is what the encoder
 * (`resolveToolParamSync`) was keyed by — a decoder must be the exact inverse of its
 * encoder. Keying off the tool's declared type instead would corrupt every
 * `dropdown`-backed boolean: a dropdown's value is a string on the canvas too, so the
 * ~225 `params.x === 'true'` comparisons inside block `tools.config.params` functions
 * are correct there and must keep receiving a string.
 *
 * A `checkbox-list` holds one record of `{ optionId: boolean }` under its own key, like
 * every other multi-value control. Its options then project onto separate tool params —
 * see {@link expandSubBlockValueToParams}.
 */
export function getSubBlockValueShape(
  subBlock: Pick<SubBlockConfig, 'type'> & { multiSelect?: boolean }
): ToolParamValueShape {
  if (subBlock.type === 'switch') return 'boolean'
  if (subBlock.type === 'slider') return 'number'
  if (OBJECT_VALUED_SUBBLOCK_TYPES.has(subBlock.type)) return 'json'
  if (subBlock.multiSelect) return 'json'
  return 'string'
}

/**
 * The tool params a sub-block's stored value projects onto, when it is not the plain
 * one-sub-block-one-param case.
 *
 * A `checkbox-list` is the only control that groups SEVERAL boolean tool params behind
 * one field — jina's "Options" collects `gatherLinks`, `noCache`, `jsonResponse` and six
 * more. Its option ids are param names, which is also how a param resolves back to it.
 *
 * Returning the params here rather than letting the control write them directly is what
 * keeps the sub-block invariant intact: one sub-block owns exactly one store key. When
 * the control wrote each option id as its own top-level key instead, the canvas
 * serializer dropped every one of them (no matching sub-block config) and a tool row
 * never mirrored them at all.
 *
 * `null` means no projection — the caller keeps its normal one-key behavior.
 */
export function expandSubBlockValueToParams(
  subBlock: Pick<SubBlockConfig, 'type' | 'options'>,
  value: unknown
): Record<string, boolean> | null {
  if (subBlock.type !== 'checkbox-list') return null

  const options = Array.isArray(subBlock.options) ? subBlock.options : []
  const selections = value && typeof value === 'object' && !Array.isArray(value) ? value : {}

  const params: Record<string, boolean> = {}
  for (const option of options) {
    if (!option || typeof option !== 'object' || !('id' in option) || !option.id) continue
    const optionId = String(option.id)
    const selected = (selections as Record<string, unknown>)[optionId]
    const fallback = (option as { defaultChecked?: boolean }).defaultChecked

    // An option the user never touched is OMITTED, not sent as `false`. Several tools
    // distinguish the two — Asana's `update_task` un-completes a task on an explicit
    // `false` and must leave it alone otherwise. A declared `defaultChecked` is a real
    // choice the field is displaying, so that does get sent.
    if (typeof selected === 'boolean') {
      params[optionId] = selected
    } else if (typeof fallback === 'boolean') {
      params[optionId] = fallback
    }
  }
  return params
}

/** Whether a sub-block's store value must be JSON-encoded to cross the `tool.params` boundary. */
export function holdsObjectValue(
  subBlock: Pick<SubBlockConfig, 'type'> & { multiSelect?: boolean }
): boolean {
  return getSubBlockValueShape(subBlock) === 'json'
}

/**
 * The value shape implied by a tool param's declared type.
 *
 * Only correct for a param with no sub-block of its own — a synthesized field, whose
 * sub-block type this module chose. Where a real sub-block exists,
 * {@link getSubBlockValueShape} wins.
 */
export function getToolParamValueShape(paramType: string | undefined): ToolParamValueShape {
  switch (paramType) {
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
 * Encodes a sub-block store value for storage in `StoredTool.params`.
 *
 * Paired with {@link decodeToolParamValue} in this file so the two cannot drift.
 */
export function encodeToolParamValue(storeValue: unknown): string {
  if (storeValue === null || storeValue === undefined) return ''
  if (typeof storeValue === 'string') return storeValue
  return JSON.stringify(storeValue)
}

/**
 * Restores a `StoredTool.params` string to the value shape the tool and the block's
 * `tools.config.params` function expect — the same shape the canvas would deliver.
 *
 * Total by construction. Every branch keeps the original value on failure:
 *
 * - A non-string passes through untouched, which is the whole idempotency story. Model
 *   arguments arrive already typed, `tools.config.params` output is already typed, and
 *   `paramsTransform` runs twice (once for execution, once for the secret-provenance
 *   projection), so decoding must be a fixed point.
 * - `''` stays `''` for every shape. It is the "untouched field" sentinel that
 *   `isNonEmpty`, `mergeToolParameters`, `createLLMToolSchema`, and
 *   `validateRequiredParametersAfterMerge` all key off; turning it into `false`/`0`
 *   would suppress the model's value or trip required-param validation.
 * - `'json'` accepts only an object or an array, so a bare `'null'` never reads as a
 *   cleared field and a `'5'` on a mis-declared param stays recognizable. This makes
 *   the function the exact inverse of {@link encodeToolParamValue}.
 * - A boolean token the encoder never produces (`'yes'`, an unresolved
 *   `'<start.flag>'`) stays a string rather than becoming a silent `true`.
 * - Nothing throws. A throw here is caught and downgraded by `prepareToolExecution`,
 *   and on the projection pass it marks the resolved-secret registry incomplete —
 *   trading a type mismatch for a silent loss of provenance tracking.
 */
export function decodeToolParamValue(raw: unknown, shape: ToolParamValueShape): unknown {
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
        if (typeof parsed !== 'object' || parsed === null) return raw
        return parsed
      } catch (error) {
        logger.warn('Tool param declared as JSON did not parse; passing through as text', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
        return raw
      }
    }
    default:
      return raw
  }
}

/**
 * The value shape of every key a block-based tool can receive, keyed by the id the
 * value is stored under.
 *
 * A sub-block wins over the tool's declaration, because the sub-block is what produced
 * the encoding. A canonical pair resolves under its canonical id, since by the time
 * this map is consulted the pair has already collapsed onto that key. Anything with
 * neither a sub-block nor a declaration is absent from the map and left alone.
 */
export function buildToolParamShapes(
  subBlocks: readonly (Pick<SubBlockConfig, 'type' | 'id' | 'canonicalParamId'> & {
    multiSelect?: boolean
  })[],
  toolParams: Record<string, { type?: string }> | undefined
): Map<string, ToolParamValueShape> {
  const shapes = new Map<string, ToolParamValueShape>()

  for (const [paramId, param] of Object.entries(toolParams ?? {})) {
    shapes.set(paramId, getToolParamValueShape(param.type))
  }

  /**
   * Sub-block shapes, resolved before they overwrite the declarations so a canonical id
   * carrying two members reaches one answer. First member wins, except that `'json'`
   * beats any other shape: the two sides of a file pair encode differently (an uploaded
   * descriptor array versus a bare reference string), and `'json'` handles both — it
   * keeps a value that is not an object or array exactly as it found it.
   */
  const fromSubBlocks = new Map<string, ToolParamValueShape>()
  const claim = (id: string, shape: ToolParamValueShape): void => {
    const existing = fromSubBlocks.get(id)
    if (existing === undefined || (shape === 'json' && existing !== 'json')) {
      fromSubBlocks.set(id, shape)
    }
  }

  for (const subBlock of subBlocks) {
    const shape = getSubBlockValueShape(subBlock)
    claim(subBlock.id, shape)
    if (subBlock.canonicalParamId) claim(subBlock.canonicalParamId, shape)
  }

  for (const [id, shape] of fromSubBlocks) shapes.set(id, shape)

  return shapes
}

/**
 * Decodes every stringified value in a tool's params back to the shape the tool and
 * the block's `tools.config.params` function expect.
 */
export function decodeToolParams(
  params: Record<string, unknown>,
  shapes: ReadonlyMap<string, ToolParamValueShape>,
  /**
   * Sub-blocks whose value projects onto several params rather than one — currently
   * only `checkbox-list`. Omitted where no such projection is possible (an MCP or
   * custom tool has no sub-blocks).
   */
  projectingSubBlocks: readonly Pick<SubBlockConfig, 'type' | 'id' | 'options'>[] = []
): Record<string, unknown> {
  const decoded: Record<string, unknown> = { ...params }
  for (const [key, value] of Object.entries(decoded)) {
    const shape = shapes.get(key)
    if (shape) decoded[key] = decodeToolParamValue(value, shape)
  }

  for (const subBlock of projectingSubBlocks) {
    if (!Object.hasOwn(decoded, subBlock.id)) continue
    const expanded = expandSubBlockValueToParams(subBlock, decoded[subBlock.id])
    if (!expanded) continue
    delete decoded[subBlock.id]
    Object.assign(decoded, expanded)
  }

  return decoded
}

/**
 * A `SubBlockConfig` for a tool param the block does not surface as a sub-block.
 *
 * The 87 `user-only` params in this position have no other channel — they are excluded
 * from the model's schema — so they must remain settable. The `user-or-llm` ones the
 * model can also fill, but the user must still be able to override.
 *
 * `condition` is deliberately absent. A param whose sub-block exists but whose
 * condition currently fails is claimed by its sub-block and never reaches here, so an
 * unconditional field matches the behavior these params already have.
 */
export function buildSubBlockForToolParam(
  paramId: string,
  param: {
    type?: string
    required?: boolean
    visibility?: ParameterVisibility
    description?: string
  },
  title: string,
  isPassword: boolean
): SubBlockConfig {
  const type = subBlockTypeForValueType(param.type)
  const subBlock: SubBlockConfig = {
    id: paramId,
    title,
    type,
    required: param.required === true,
    paramVisibility: param.visibility ?? (param.required ? 'user-or-llm' : 'user-only'),
  }

  if (type === 'code') {
    subBlock.language = 'json'
  }

  if (type === 'file-upload') {
    subBlock.acceptedTypes = '*'
    subBlock.multiple = param.type === 'file[]'
  }

  if (type === 'short-input') {
    if (param.description) subBlock.placeholder = param.description
    if (isPassword) subBlock.password = true
  }

  return subBlock
}

/**
 * The sub-block collecting a JSON Schema property, for MCP and custom tools.
 *
 * A JSON Schema carries constraints a `ToolConfig` param declaration cannot, so this
 * map is legitimately richer than {@link subBlockTypeForValueType}: `enum` supplies a
 * dropdown's options and `minimum`/`maximum` supply a slider's bounds. Shared with the
 * MCP block's own args editor so the same tool renders identically on both surfaces.
 */
export function subBlockTypeForJsonSchema(property: JsonSchemaProperty): SubBlockType {
  if (Array.isArray(property.enum)) {
    // A non-primitive member cannot be an option label, so the whole enum falls back
    // to free text. `null` is a legal, renderable member.
    return property.enum.every((option) => option === null || typeof option !== 'object')
      ? 'dropdown'
      : 'long-input'
  }

  const type = jsonSchemaType(property)
  if (type === 'boolean') return 'switch'
  if (type === 'number' || type === 'integer') {
    return finiteNumber(property.minimum) !== undefined &&
      finiteNumber(property.maximum) !== undefined
      ? 'slider'
      : 'short-input'
  }
  if (type === 'array' || type === 'object') return 'code'

  const maxLength = finiteNumber(property.maxLength)
  if (type === 'string' && maxLength !== undefined && maxLength > 100) return 'long-input'

  return 'short-input'
}

/** The value shape a JSON Schema property's control writes, for MCP and custom tools. */
function getJsonSchemaValueShape(property: JsonSchemaProperty): ToolParamValueShape {
  return getSubBlockValueShape({ type: subBlockTypeForJsonSchema(property) })
}

/** The value shape of every argument an MCP or custom tool's schema declares. */
export function buildJsonSchemaParamShapes(
  schema: JsonSchemaObject | undefined
): Map<string, ToolParamValueShape> {
  const shapes = new Map<string, ToolParamValueShape>()
  for (const [paramId, property] of jsonSchemaProperties(schema)) {
    shapes.set(paramId, getJsonSchemaValueShape(property))
  }
  return shapes
}

/**
 * The subset of JSON Schema this module reads.
 *
 * Every field is `unknown` because an MCP server supplies these over the wire and may
 * send anything — including the legal-but-awkward `type: ['string', 'null']`. The
 * readers below narrow rather than trusting the declaration.
 */
export interface JsonSchemaProperty {
  type?: unknown
  description?: unknown
  enum?: unknown
  minimum?: unknown
  maximum?: unknown
  maxLength?: unknown
  [key: string]: unknown
}

export interface JsonSchemaObject {
  properties?: unknown
  required?: unknown
}

/** The declared properties of an untrusted schema, as `paramId -> property` pairs. */
function jsonSchemaProperties(
  schema: JsonSchemaObject | undefined
): Array<[string, JsonSchemaProperty]> {
  const { properties } = schema ?? {}
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []
  return Object.entries(properties as Record<string, unknown>).map(([paramId, property]) => [
    paramId,
    property && typeof property === 'object' && !Array.isArray(property)
      ? (property as JsonSchemaProperty)
      : {},
  ])
}

/** The required param names of an untrusted schema. */
function jsonSchemaRequired(schema: JsonSchemaObject | undefined): Set<string> {
  const { required } = schema ?? {}
  if (!Array.isArray(required)) return new Set()
  return new Set(required.filter((entry): entry is string => typeof entry === 'string'))
}

/** The declared type, tolerating a union such as `['string', 'null']`. */
function jsonSchemaType(property: JsonSchemaProperty): string | undefined {
  const { type } = property
  if (typeof type === 'string') return type
  if (Array.isArray(type)) {
    const named = type.find((entry) => typeof entry === 'string' && entry !== 'null')
    return typeof named === 'string' ? named : undefined
  }
  return undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * `SubBlockConfig`s for an MCP or custom tool's arguments, so they render through the
 * canonical sub-block renderer rather than a parallel one.
 *
 * A required property is `user-or-llm` and an optional one is `user-only`, preserving
 * the visibility the tool row assigned these params before this existed.
 */
export function buildSubBlocksFromJsonSchema(
  schema: JsonSchemaObject | undefined,
  formatTitle: (paramId: string) => string
): SubBlockConfig[] {
  const required = jsonSchemaRequired(schema)

  return jsonSchemaProperties(schema).map(([paramId, property]) => {
    const type = subBlockTypeForJsonSchema(property)
    const isRequired = required.has(paramId)
    const subBlock: SubBlockConfig = {
      id: paramId,
      title: formatTitle(paramId),
      type,
      required: isRequired,
      paramVisibility: isRequired ? 'user-or-llm' : 'user-only',
    }

    if (type === 'dropdown' && Array.isArray(property.enum)) {
      subBlock.options = property.enum.map((option) => ({
        label: String(option),
        id: String(option),
      }))
    }
    if (type === 'slider') {
      subBlock.min = finiteNumber(property.minimum)
      subBlock.max = finiteNumber(property.maximum)
      subBlock.integer = jsonSchemaType(property) === 'integer'
    }
    if (type === 'code') {
      subBlock.language = 'json'
    }
    if (
      (type === 'short-input' || type === 'long-input') &&
      typeof property.description === 'string'
    ) {
      subBlock.placeholder = property.description
    }

    return subBlock
  })
}
