/**
 * One builder described at the terminal, from the catalog the declarations are generated from:
 * what `sim workflows source params <builder>` prints, and the snippet the source primer carries
 * for each builder a directory already uses. The params, their required-ness and the outputs are
 * the generated declarations' own (`builderTypes`), so the two never disagree.
 */

import { compareStrings, escapeRegExp } from '@sim/utils/string'
import type { BlockCatalog } from '@sim/workflow-code'
import { suggestBuilder } from '@sim/workflow-code'
import { catalogBlock, catalogBuilder, catalogBuilderPaths } from '@sim/workflow-code/catalog/view'
import { SDK_CORE_EXPORTS } from '@sim/workflow-code/sdk'
import { CORE_DTS } from './core-text.generated'
import { builderTypes, operationLabel, type ParamFact, type ParamFacts } from './generate'
import { isLegacyBuilder } from './layout'
import { builderEntry, TOOL_NAMESPACE } from './names'

/** A builder as `sim workflows source params` reports it. */
export interface BuilderReference {
  /** The dotted builder path (`slack.sendMessage`). */
  key: string
  blockType: string
  /** `Block: Operation`. */
  summary: string
  operation?: string
  /** An older block version's builder, kept so stored workflows print; write the current one. */
  legacy: boolean
  /** What `core.d.ts` says of a builder it declares itself (`response`, `fn`), as prose. */
  doc?: string
  /** The call, as the declarations type it. */
  signature: string
  /** The agent tool form (`slack.tool.sendMessage(…)`), when the builder has one. */
  tool: string | null
  paramsName: string
  params: ParamFacts
  /** Params `core.d.ts` types for the builder itself (`fn`'s `code`), not listed in `params`. */
  coreParams: readonly string[]
  outputName: string
  /** The output type's members as the declaration holds them, one line each. */
  outputs: string[]
}

/** A builder of a namespace, in a lookup's list. */
interface BuilderSummary {
  key: string
  summary: string
}

/** What a builder lookup found. */
export type BuilderLookup =
  | { kind: 'builder'; reference: BuilderReference }
  | { kind: 'namespace'; namespace: string; builders: BuilderSummary[] }
  | { kind: 'core'; name: string; declaration: string }
  | { kind: 'missing'; hint?: string }

/** `Block: Operation` for a catalog builder. */
function summaryOf(catalog: BlockCatalog, key: string): string {
  const builder = catalogBuilder(catalog, key)
  const block = builder ? catalogBlock(catalog, builder.type) : undefined
  if (!builder || !block) return key
  const label = builder.operation ? operationLabel(block, builder.operation) : undefined
  return [block.name, label].filter(Boolean).join(': ')
}

/** `slack.tool.sendMessage` → `slack.sendMessage`: the tool form names the same builder. */
function withoutToolSegment(query: string): string {
  const path = query.split('.')
  const at = path.indexOf(TOOL_NAMESPACE)
  if (at > 0 && at === path.length - 2) path.splice(at, 1)
  return path.join('.')
}

/** The reference of the catalog builder `key`, or `null` when the catalog has none. */
export function describeBuilder(catalog: BlockCatalog, key: string): BuilderReference | null {
  const entry = builderEntry(catalog, key)
  if (!entry) return null
  const types = builderTypes(catalog, entry)
  const signature = entry.special
    ? coreSignatures(key)
    : `${entry.path.slice(0, -1).join('.')}.${(types.signature.at(-1) ?? '').replace(/^export function /, '')}`.replace(
        /^\./,
        ''
      )
  const tool = types.tool
    ? `${entry.path.slice(0, -1).join('.')}.${TOOL_NAMESPACE}.${(types.tool.at(-1) ?? '').replace(/^export function /, '')}`
    : null
  return {
    key,
    blockType: entry.builder.type,
    summary: types.summary,
    ...(entry.builder.operation ? { operation: entry.builder.operation } : {}),
    legacy: isLegacyBuilder(key),
    ...(entry.special ? docOf(key) : {}),
    signature,
    tool,
    paramsName: types.paramsName,
    params: types.facts,
    coreParams: entry.special?.coreParams ?? [],
    outputName: types.output.name,
    outputs: types.output.body === '' ? [] : types.output.body.split('\n'),
  }
}

/**
 * Looks `query` up as a builder (`table.upsertRow`, `slack.tool.sendMessage`), a namespace
 * (`gmail`, `trigger`: its builders listed), a construct `core.d.ts` declares (`loop`, `t`), or a
 * block type whose builder is named otherwise (`function` is `fn`; `table_v2` lists the `table.*`
 * builders); otherwise reports the closest builder or namespace as a hint.
 */
export function lookupBuilder(catalog: BlockCatalog, query: string): BuilderLookup {
  const key = withoutToolSegment(query.trim())
  const reference = describeBuilder(catalog, key)
  if (reference) return { kind: 'builder', reference }
  const paths = catalogBuilderPaths(catalog).sort(compareStrings)
  const builders = paths
    .filter((path) => path.startsWith(`${key}.`))
    .map((path) => ({ key: path, summary: summaryOf(catalog, path) }))
  if (builders.length > 0) return { kind: 'namespace', namespace: key, builders }
  const root = key.split('.')[0] ?? key
  if ((SDK_CORE_EXPORTS as readonly string[]).includes(root)) {
    return { kind: 'core', name: key, declaration: coreDeclaration(root) }
  }
  const ofBlockType = paths.filter((path) => catalogBuilder(catalog, path)?.type === key)
  const only = ofBlockType.length === 1 ? describeBuilder(catalog, ofBlockType[0]) : null
  if (only) return { kind: 'builder', reference: only }
  if (ofBlockType.length > 1) {
    return {
      kind: 'namespace',
      namespace: key,
      builders: ofBlockType.map((path) => ({ key: path, summary: summaryOf(catalog, path) })),
    }
  }
  const hint = suggestBuilder(
    key,
    paths.filter((path) => !isLegacyBuilder(path))
  )
  return hint ? { kind: 'missing', hint } : { kind: 'missing' }
}

const MAX_CORE_LINES = 80

const CORE_LINES = CORE_DTS.split('\n')

/** The line the doc comment above line `start` opens on, or `start` when none is there. */
function docCommentStart(start: number): number {
  if (!CORE_LINES[start - 1]?.trim().endsWith('*/')) return start
  let first = start - 1
  while (first > 0 && !CORE_LINES[first].trim().startsWith('/**')) first--
  return first
}

/** Each top-level declaration of `name` in `core.d.ts` (overloads included): its line range. */
function coreDeclarationRanges(name: string): Array<{ start: number; end: number }> {
  const start = new RegExp(
    `^export (?:declare )?(?:const|function|namespace|interface|type) ${escapeRegExp(name)}\\b`
  )
  const declarations: Array<{ start: number; end: number }> = []
  for (let index = 0; index < CORE_LINES.length; index++) {
    if (!start.test(CORE_LINES[index])) continue
    let depth = 0
    let end = index
    for (; end < CORE_LINES.length; end++) {
      for (const char of CORE_LINES[end]) {
        if ('({['.includes(char)) depth++
        else if (')}]'.includes(char)) depth--
      }
      const continues =
        /[=:,|&]\s*$/.test(CORE_LINES[end]) || /^\s+[?:|&]/.test(CORE_LINES[end + 1] ?? '')
      if (depth <= 0 && !continues) break
    }
    declarations.push({ start: index, end: end + 1 })
    index = end
  }
  return declarations
}

/**
 * A special builder's call as `core.d.ts` declares it (`condition` takes its branches, `note`
 * returns an `Annotation`), one line per overload.
 */
function coreSignatures(name: string): string {
  return coreDeclarationRanges(name)
    .map(({ start, end }) =>
      CORE_LINES.slice(start, end)
        .join(' ')
        .replace(/^export (?:declare )?function /, '')
        .replace(/\s+/g, ' ')
        .replace(/([(<]) /g, '$1')
        .replace(/,? ([)>])/g, '$1')
        .trim()
    )
    .join('\n')
}

/**
 * Every top-level declaration of `name` in `core.d.ts` (overloads included) with the doc comment
 * above it, as the file holds it: what a construct the catalog does not generate takes.
 */
function coreDeclaration(name: string): string {
  const out: string[] = []
  for (const { start, end } of coreDeclarationRanges(name)) {
    if (out.length > 0) out.push('')
    out.push(...CORE_LINES.slice(docCommentStart(start), end))
  }
  return out.slice(0, MAX_CORE_LINES).join('\n')
}

/** The doc comment above the first declaration of `name` in `core.d.ts`, as one paragraph. */
function docOf(name: string): Pick<BuilderReference, 'doc'> {
  const range = coreDeclarationRanges(name)[0]
  if (!range) return {}
  const doc = CORE_LINES.slice(docCommentStart(range.start), range.start)
    .map((line) => line.trim().replace(/^\/\*\*\s?|\s?\*\/$|^\*\s?/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return doc ? { doc } : {}
}

const MAX_SNIPPET_TYPE = 60
const MAX_SNIPPET_OPTIONAL = 12

/** A type short enough for one snippet line. */
function shortType(type: string): string {
  const flat = type.replace(/\s+/g, ' ')
  return flat.length > MAX_SNIPPET_TYPE ? `${flat.slice(0, MAX_SNIPPET_TYPE - 1)}…` : flat
}

/** A value of `type` for an example call: a literal it allows, else a placeholder. */
function exampleValue(type: string): string {
  const literal = /^\s*('(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)\s*(?:\||$)/.exec(type)
  if (literal) return literal[1]
  if (/^CredentialRef\b/.test(type)) return "credential('<key>')"
  if (/^TableRef\b/.test(type)) return "table('<key>')"
  if (/^TableData\b/.test(type)) return "{ column: '…' }"
  if (/^KnowledgeBaseRef\b/.test(type)) return "knowledgeBase('<key>')"
  if (/^WorkflowRef\b/.test(type)) return "childWorkflow('<key>')"
  if (/^(?:Template|string|Value<string)\b/.test(type)) return "'…'"
  if (/^(?:number|Value<number)\b/.test(type)) return '1'
  if (/^(?:boolean|Value<boolean)\b/.test(type)) return 'true'
  if (/^(?:Array<|[\w<>]+\[\])/.test(type)) return '[]'
  return `<${shortType(type.split(' | ')[0] ?? type)}>`
}

/** The names of an output type's top-level members. */
function outputNames(outputs: readonly string[]): string[] {
  return outputs.flatMap((line) => {
    const member = /^ {2}(?:readonly )?'?([\w$-]+)'?\??:/.exec(line)
    return member ? [member[1]] : []
  })
}

function paramLine(param: ParamFact): string {
  const fallback = param.default !== undefined ? ` = ${JSON.stringify(param.default)}` : ''
  return `${param.key}: ${shortType(param.type)}${fallback}`
}

/**
 * A few lines for the source primer: the call with its required params filled in, the required
 * params with their types, the optional ones by name, and the outputs.
 */
export function builderSnippet(reference: BuilderReference): string {
  const required = reference.params.common.filter((param) => param.required)
  const optional = reference.params.common.filter((param) => !param.required)
  const gate = reference.params.gate
  const variant = gate
    ? (gate.variants.find((v) => gate.default !== undefined && v.values.includes(gate.default)) ??
      gate.variants[0])
    : undefined
  const args = [
    ...required.map((param) => `${param.key}: ${exampleValue(param.type)}`),
    ...(gate && variant && gate.default === undefined
      ? [`${gate.key}: ${JSON.stringify(variant.values[0])}`]
      : []),
    ...(variant?.params ?? [])
      .filter((param) => param.required)
      .map((param) => `${param.key}: ${exampleValue(param.type)}`),
  ]
  const call = `${reference.key}('Name', ${args.length > 0 ? `{ ${args.join(', ')} }` : '{}'})`
  const lines = [`- \`${reference.key}\` (${reference.summary}): \`const x = ${call}\``]
  if (required.length > 0) lines.push(`  required: ${required.map(paramLine).join('; ')}`)
  if (gate) {
    const variants = gate.variants.map((variant) => {
      const needed = variant.params.filter((param) => param.required).map((param) => param.key)
      return `${variant.values.map((value) => JSON.stringify(value)).join('|')}${needed.length > 0 ? ` → ${needed.join(', ')}` : ''}`
    })
    const fallback = gate.default !== undefined ? ` (default ${JSON.stringify(gate.default)})` : ''
    lines.push(`  ${gate.key}${fallback} picks the rest: ${variants.join('; ')}`)
  }
  if (optional.length > 0) {
    const shown = optional.slice(0, MAX_SNIPPET_OPTIONAL).map((param) => param.key)
    const more = optional.length > shown.length ? `, +${optional.length - shown.length} more` : ''
    lines.push(`  optional: ${shown.join(', ')}${more}`)
  }
  if (reference.coreParams.length > 0) {
    lines.push(`  core.d.ts types: ${reference.coreParams.join(', ')}`)
  }
  const outputs = outputNames(reference.outputs)
  if (outputs.length > 0) lines.push(`  outputs: ${outputs.join(', ')}`)
  return lines.join('\n')
}

function describeParam(param: ParamFact, indent: string): string[] {
  const fallback = param.default !== undefined ? ` (default ${JSON.stringify(param.default)})` : ''
  const head = `${indent}${param.key}${param.required ? '' : '?'}: ${param.type}${fallback}`
  return [head, ...param.doc.map((line) => `${indent}    ${line}`)]
}

/** The full text `sim workflows source params <builder>` prints for one builder. */
export function renderBuilderReference(reference: BuilderReference): string {
  const where = [
    `block ${reference.blockType}`,
    reference.operation && `operation ${reference.operation}`,
  ]
    .filter(Boolean)
    .join(', ')
  const lines = [`${reference.key} — ${reference.summary} (${where})`]
  if (reference.legacy) {
    lines.push('Legacy: an older block version. Write the current builder instead.')
  }
  if (reference.doc) lines.push('', reference.doc)
  lines.push('', reference.signature)
  if (reference.tool) lines.push(`${reference.tool}  (as an agent tool)`)
  const required = reference.params.common.filter((param) => param.required)
  const optional = reference.params.common.filter((param) => !param.required)
  lines.push('', `Params (${reference.paramsName}):`)
  if (reference.params.common.length === 0 && !reference.params.gate) lines.push('  (none)')
  for (const param of [...required, ...optional]) lines.push(...describeParam(param, '  '))
  const gate = reference.params.gate
  if (gate) {
    const fallback = gate.default !== undefined ? ` (default ${JSON.stringify(gate.default)})` : ''
    lines.push(`  ${gate.key}${fallback} picks which of these apply:`)
    for (const variant of gate.variants) {
      lines.push(
        `    ${gate.key}: ${variant.values.map((value) => JSON.stringify(value)).join(' | ')}`
      )
      for (const param of variant.params) lines.push(...describeParam(param, '      '))
    }
  }
  if (reference.coreParams.length > 0) {
    lines.push(`  Also typed in core.d.ts: ${reference.coreParams.join(', ')}`)
  }
  lines.push('', `Outputs (${reference.outputName}):`)
  lines.push(...(reference.outputs.length > 0 ? reference.outputs : ['  (none)']))
  return lines.join('\n')
}
