/**
 * Output types for a builder. Static outputs come from the catalog, narrowed per
 * operation by `OutputCondition` with the same three-way evaluator as params: an output that is
 * never available for the builder is dropped, one that depends on other fields keeps a `@when`.
 * Nested outputs recurse to {@link MAX_OUTPUT_DEPTH}, then fall back to `Json`.
 *
 * Dynamic outputs (`dynamicOutputs: { source, param }`) are inferred from
 * the param value through const generics; {@link dynamicOutputPlan} says which generic a builder
 * takes and how it changes params and outputs.
 */

import type { CatalogDynamicOutputs, CatalogOutput } from '@sim/workflow-code'
import { printKey } from '@sim/workflow-code'
import { arrayOf, jsdoc } from './emit'
import { clauseFields, evaluateClause, type VisibilityContext } from './visibility'

const MAX_OUTPUT_DEPTH = 4

function outputType(output: CatalogOutput, depth: number): string {
  if (depth > MAX_OUTPUT_DEPTH) return 'Json'
  switch (output.type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'file':
      return 'SimFile'
    case 'file[]':
      return 'SimFile[]'
    case 'array':
      return output.items ? arrayOf(outputType(output.items, depth + 1)) : 'Json[]'
    case 'json':
      return output.properties && Object.keys(output.properties).length > 0
        ? objectType(output.properties, depth + 1)
        : 'Json'
    default:
      return 'Json'
  }
}

function objectType(properties: Record<string, CatalogOutput>, depth: number): string {
  if (depth > MAX_OUTPUT_DEPTH) return 'Json'
  const members = Object.keys(properties).map(
    (key) => `${printKey(key)}: ${outputType(properties[key], depth)}`
  )
  return `{ ${members.join('; ')} }`
}

interface OutputMember {
  name: string
  type: string
  doc: string[]
}

/**
 * The outputs a builder exposes, in catalog order, with `overrides` replacing a member's type
 * (dynamic outputs such as typed table rows) and each `nullable` one also taking `null`.
 */
export function builderOutputs(
  outputs: Record<string, CatalogOutput>,
  context: VisibilityContext,
  overrides: Readonly<Record<string, string>> = {},
  nullable: ReadonlySet<string> = new Set()
): OutputMember[] {
  const members: OutputMember[] = []
  for (const name of Object.keys(outputs)) {
    const output = outputs[name]
    const doc: string[] = output.description ? [output.description] : []
    if (output.condition) {
      const available = evaluateClause(output.condition, context, {})
      if (available === false) continue
      if (available === null) {
        doc.push(`@when depends on ${clauseFields(output.condition).join(' and ')}`)
      }
    }
    const type = overrides[name] ?? outputType(output, 1)
    members.push({ name, type: nullable.has(name) ? `${type} | null` : type, doc })
  }
  return members
}

/** Renders output members as a type literal body, one member per line. */
export function renderMembers(members: readonly OutputMember[], indent: string): string[] {
  const lines: string[] = []
  for (const member of members) {
    lines.push(...jsdoc(member.doc, indent))
    lines.push(`${indent}${printKey(member.name)}: ${member.type}`)
  }
  return lines
}

export interface DynamicOutputPlan {
  /** The type parameter declaration, e.g. `const RF extends ResponseFormat | undefined = undefined`. */
  typeParameter: { name: string; constraint: string; fallback: string; isConst: boolean }
  /** The param that carries the generic, and its type. */
  param: { name: string; type: string }
  /** Extra param types keyed by param name (typed table data). */
  paramOverrides: Record<string, string>
  /** Output member types replaced by the generic. */
  outputOverrides: Record<string, string>
  /** A type intersected with the static outputs. */
  outputExtension: string | null
}

/** Table operations that merge `data` over a stored row rather than write a whole row. */
const TABLE_PATCH_OPERATIONS: ReadonlySet<string> = new Set(['update_row', 'update_rows_by_filter'])

/**
 * The row type a table operation's `data` takes: an update writes a patch (`TableDataPatch`, every
 * column optional), and any other operation, or a builder with no operation, a whole row
 * (`TableData`, required columns required).
 */
function tableDataType(operation: string | undefined): 'TableData' | 'TableDataPatch' {
  return operation !== undefined && TABLE_PATCH_OPERATIONS.has(operation)
    ? 'TableDataPatch'
    : 'TableData'
}

/**
 * How a block's dynamic outputs become a const generic. `null` for `humanForm`, which `core.d.ts`
 * types on `human()` itself.
 */
export function dynamicOutputPlan(
  spec: CatalogDynamicOutputs,
  outputs: Record<string, CatalogOutput>,
  operation?: string
): DynamicOutputPlan | null {
  switch (spec.source) {
    case 'responseFormat':
      return {
        typeParameter: {
          name: 'RF',
          constraint: 'ResponseFormat | undefined',
          fallback: 'undefined',
          isConst: true,
        },
        param: { name: spec.param, type: 'RF' },
        paramOverrides: {},
        outputOverrides: {},
        outputExtension: 'ResponseFormatOutput<RF>',
      }
    case 'inputFormat':
      return {
        typeParameter: {
          name: 'F',
          constraint: 'InputFields',
          fallback: 'Record<never, never>',
          isConst: true,
        },
        param: { name: spec.param, type: 'F' },
        paramOverrides: {},
        outputOverrides: {},
        outputExtension: 'InputFieldsOutput<F>',
      }
    case 'tableRows': {
      const outputOverrides: Record<string, string> = {}
      if (outputs.row) outputOverrides.row = 'TableRow<T>'
      if (outputs.rows) outputOverrides.rows = 'TableRow<T>[]'
      return {
        typeParameter: { name: 'T', constraint: 'string', fallback: 'string', isConst: false },
        param: { name: spec.param, type: 'TableRef<T> | Value<string>' },
        paramOverrides: {
          data: `${tableDataType(operation)}<T> | Template`,
          rows: 'TableData<T>[] | Template',
        },
        outputOverrides,
        outputExtension: null,
      }
    }
    case 'humanForm':
      return null
  }
}
