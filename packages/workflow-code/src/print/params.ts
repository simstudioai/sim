/**
 * A block's params as source: which ids print and under which names, each value's printed form
 * (code files, JSON fields, input-format records), and the `todo()` a missing required field gets.
 */

import { compareStrings } from '@sim/utils/string'
import {
  type ActivityInputs,
  canonicalActivityInputs,
  executableInactiveParams,
  isInactive,
  withStoredValue,
} from '../catalog/activity'
import { recordLookup } from '../catalog/conditions'
import { type EditorDefault, editorDefaults } from '../catalog/defaults'
import {
  buildFieldIndex,
  declarationFor,
  isCredentialIdTwin,
  isWrittenInSource,
  memberFor,
  requiredForBuilder,
  requiredForValues,
  typedForBuilder,
} from '../catalog/surface'
import type { CatalogBlock, CatalogSubBlock } from '../catalog/types'
import { type CodeFileLanguage, checkCodeFileBijection } from '../code-files'
import { diagnostic } from '../diagnostics/factory'
import type { ResponseForm } from '../forms/response'
import { JsonRef, type JsonTree, jsonFieldText, parseJsonField, refValueKind } from '../json-fields'
import { CODE_FILE_EXTENSIONS, isCodeFilePath, SOURCE_CODE_DIR } from '../limits'
import type { AnchorKey, CanonicalBlock, ParamMode, Value } from '../model'
import { getOwn, setOwn } from '../records'
import type { TemplateTag } from '../sdk'
import { holdsSecret } from '../secrets'
import { structuredCodec } from '../structured'
import { anchors } from './comments'
import { foldCodePath, type PrintContext } from './context'
import { printKey } from './strings'
import { arrayExpr, type Expr, objectExpr, type Property, pathDepth } from './syntax'
import { printTools, storedSecret } from './tools'
import { type FieldContext, type PrintedValue, refExpr } from './values'

function toLanguage(value: unknown): CodeFileLanguage | null {
  if (value === 'javascript' || value === 'js') return 'javascript'
  if (value === 'python' || value === 'py') return 'python'
  if (value === 'shell' || value === 'bash' || value === 'sh') return 'shell'
  return null
}

/** A param's value when it is text. */
export function stringParam(block: CanonicalBlock, id: string): string | undefined {
  const param = getOwn(block.params, id)
  return param?.kind === 'value' && typeof param.value === 'string' ? param.value : undefined
}

function hasValue(block: CanonicalBlock, id: string): boolean {
  return getOwn(block.params, id) !== undefined
}

/** The block's plain param values by id, which conditions read. */
function paramValues(block: CanonicalBlock): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [id, param] of Object.entries(block.params)) {
    if (param.kind === 'value') setOwn(values, id, param.value)
  }
  return values
}

function kebab(ident: string): string {
  return ident
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

/** The `null` literal. */
export const NULL_EXPR: Expr = { doc: 'null', shape: 'literal', depth: 1 }

/** One resolved param ready to print. */
interface ParamEntry {
  key: string
  anchor: AnchorKey
  value: Expr
}

function tagFor(
  block: CanonicalBlock,
  declared: CatalogBlock | undefined,
  sb?: CatalogSubBlock
): TemplateTag {
  if (sb?.valueKind === 'code') {
    if (sb.language === 'json') return 'json'
    const language = toLanguage(stringParam(block, 'language')) ?? toLanguage(sb.language)
    return language ? CODE_FILE_EXTENSIONS[language] : 'js'
  }
  if (declared?.graph.annotationOnly) return 'md'
  return 't'
}

/** How a value prints in one field: its template tag, its block, and its subBlock. */
export function fieldContext(
  block: CanonicalBlock,
  declared: CatalogBlock | undefined,
  sb?: CatalogSubBlock
): FieldContext {
  return {
    tag: tagFor(block, declared, sb),
    from: block.key,
    variablesField: structuredCodec(sb)?.varNodes === true,
    ...(sb ? { subBlock: sb } : {}),
    ...(sb && declared && isCredentialIdTwin(sb, declared.subBlocks) ? { credentialId: true } : {}),
  }
}

function printParamValue(
  ctx: PrintContext,
  block: CanonicalBlock,
  declared: CatalogBlock | undefined,
  id: string,
  sb: CatalogSubBlock | undefined,
  single = false
): PrintedValue | null {
  const param = getOwn(block.params, id)
  if (!param) return null
  if (param.kind === 'tools') return printTools(ctx, block, param.tools)
  if (holdsSecret(sb, param.value)) {
    return storedSecret(ctx, block, sb?.id ?? id, sb?.password === true)
  }
  if (single && sb?.type === 'code' && sb.valueKind === 'json' && typeof param.value === 'string') {
    const literal = printJsonField(ctx, block, param.value)
    if (literal) return literal
  }
  const context = fieldContext(block, declared, sb)
  const structured = structuredCodec(sb)?.print(param.value, {
    values: ctx.values,
    context,
    block: block.key,
  })
  if (structured) return structured
  if (
    ctx.options.functionCode === 'files' &&
    sb?.valueKind === 'code' &&
    (context.tag === 'js' || context.tag === 'py' || context.tag === 'sh') &&
    typeof param.value === 'string' &&
    !ctx.codeFileHints.has(block.key)
  ) {
    const fileExpr = printCodeFile(ctx, block, param.value, context.tag)
    if (fileExpr) return fileExpr
  }
  return ctx.values.field(param.value, context)
}

/**
 * JSON field text as the object or array literal compile turns back into exactly that text
 * (`json-fields.ts`), or `null` to keep the text form. A quoted token prints as a bare reference
 * when its value is a string and as `` t`${ref}` `` otherwise; a bare token prints bare, which
 * only a non-string value can be.
 */
function printJsonField(ctx: PrintContext, block: CanonicalBlock, text: string): Expr | null {
  const tree = parseJsonField(text)
  if (tree === undefined) return null
  const isString = (token: string) => refValueKind(token, ctx.refTypes) === 'string'
  let expressible = true
  const asCompiled = (node: JsonTree): JsonTree => {
    if (node instanceof JsonRef) {
      if (!node.quoted) {
        if (isString(node.token)) expressible = false
        return node
      }
      return isString(node.token) ? node : node.token
    }
    if (node === null || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(asCompiled)
    const result: { [key: string]: JsonTree } = {}
    for (const [key, item] of Object.entries(node)) setOwn(result, key, asCompiled(item))
    return result
  }
  const compiled = asCompiled(tree)
  if (!expressible || jsonFieldText(compiled, isString) !== text) return null
  const from = block.key
  const render = (node: JsonTree): Expr | null => {
    if (typeof node === 'string') return ctx.values.value(node, { tag: 't', from })
    if (node instanceof JsonRef) {
      const expr = ctx.refs.resolveToken(node.token, from)
      if (expr === null) return node.quoted ? ctx.values.string(node.token) : null
      if (!node.quoted || isString(node.token)) return refExpr(expr)
      ctx.imports.add('t')
      return { doc: ['t`${', expr, '}`'], shape: 'template', depth: 2 + pathDepth(expr) }
    }
    if (node === null || typeof node !== 'object') return ctx.values.json(node)
    if (Array.isArray(node)) {
      const items: Expr[] = []
      for (const item of node) {
        const printed = render(item)
        if (!printed) return null
        items.push(printed)
      }
      return arrayExpr(items)
    }
    const properties: Property[] = []
    for (const [key, item] of Object.entries(node)) {
      const printed = render(item)
      if (!printed) return null
      properties.push({ key: printKey(key), value: printed })
    }
    return objectExpr(properties)
  }
  return render(tree)
}

function printCodeFile(
  ctx: PrintContext,
  block: CanonicalBlock,
  code: string,
  tag: 'js' | 'py' | 'sh'
): PrintedValue | null {
  const language: CodeFileLanguage = tag === 'js' ? 'javascript' : tag === 'py' ? 'python' : 'shell'
  const inline = (reason: string): null => {
    ctx.diagnostics.push(
      diagnostic(
        'W_CODE_FILE_INLINED',
        `Function code of ${block.name} printed inline: ${reason}.`,
        {
          blockKey: block.key,
        }
      )
    )
    return null
  }
  const stored = stringParam(block, 'language') ?? 'javascript'
  if (stored !== language) return inline(`its language ${stored} has no code-file form`)
  const check = checkCodeFileBijection(code, language)
  if (!check.ok) return inline('its tokens cannot be rewritten for a code file')
  const text = check.file
  const extension = CODE_FILE_EXTENSIONS[language]
  const hinted = getOwn(ctx.hints.blocks, block.key)?.codeFile
  const free = (candidate: string) => {
    const owner = ctx.codePathOwners.get(foldCodePath(candidate))
    return owner === undefined || owner === block.key
  }
  let path =
    hinted?.endsWith(`.${extension}`) && isCodeFilePath(hinted) && free(hinted)
      ? hinted
      : `${SOURCE_CODE_DIR}/${kebab(ctx.idents.get(block.key) ?? block.key)}.${extension}`
  let suffix = 2
  const base = path.slice(0, -(extension.length + 1))
  while (!free(path)) {
    path = `${base}-${suffix}.${extension}`
    suffix += 1
  }
  ctx.codePathOwners.set(foldCodePath(path), block.key)
  ctx.codeFileHints.set(block.key, path)
  ctx.codeFiles.push({ path, text })
  return ctx.values.call('codeFile', [ctx.values.string(`./${path}`)])
}

/**
 * Whether a field with no stored value would reach execution holding `value`, the editor
 * default compile fills in when the field is omitted. An absent field prints `null` only then:
 * an inactive one is restored from the stored workflow either way. The value matters for a
 * standalone advanced field, which is sent only when it holds one.
 */
function activeIfSet(
  ctx: PrintContext,
  inputs: ActivityInputs,
  sb: CatalogSubBlock,
  value: Value
): boolean {
  return !isInactive(sb.id, withStoredValue(ctx.catalog, inputs, sb.id, value))
}

/**
 * Params in catalog registry order, one per canonical pair, under the
 * defaults rule: a value equal to the editor default (`editorDefaults`) is omitted, a field the
 * builder's type requires (`requiredForBuilder`, `requiredForValues`) with no stored value prints
 * `todo()`, and an
 * active field with no stored value prints `null` when a default exists. What never executes
 * (`executableInactiveParams`: inactive values, the pair member the mode hides, undeclared ids
 * that do not run) is left out; apply restores it from the stored workflow. A stored id the
 * catalog does not declare that still runs (a schema-agnostic custom block's input, the agent's
 * legacy prompt fields) goes to `extra`, the only place source takes such an id; so does a param
 * the builder's type leaves out (`typedForBuilder`) that still runs, such as an advanced field
 * the serializer forwards under an operation that hides it. A field source never writes
 * (`isWrittenInSource`: hidden, display-only, trigger system fields) is left out; compile keeps
 * its stored value.
 */
export function collectParams(
  ctx: PrintContext,
  block: CanonicalBlock,
  declared: CatalogBlock | undefined,
  pinned: Set<string>
): { params: ParamEntry[]; extra: ParamEntry[] } {
  const params: ParamEntry[] = []
  const extra: ParamEntry[] = []
  const handled = new Set<string>(pinned)
  const branchId = declared?.graph.branches?.subBlockId
  if (branchId) handled.add(branchId)
  const inactiveIds = new Set(executableInactiveParams(block, ctx.catalog))
  const defaults: ReadonlyMap<string, EditorDefault> = declared
    ? editorDefaults(declared)
    : new Map()
  const push = (list: ParamEntry[], key: string, value: Expr) => {
    list.push({ key: printKey(key), anchor: anchors.param(block.key, key), value })
  }
  const isDefault = (id: string) => {
    const param = getOwn(block.params, id)
    return param?.kind === 'value' && defaults.has(id) && defaults.get(id) === param.value
  }

  if (declared) {
    let blockInputs: ActivityInputs | undefined
    const inputs = () => {
      blockInputs ??= canonicalActivityInputs(block, declared, ctx.catalog)
      return blockInputs
    }
    const index = buildFieldIndex(declared, block.triggerMode, pinned)
    const values = paramValues(block)
    const lookup = recordLookup(values)
    const pinnedValues: Record<string, unknown> = {}
    for (const id of pinned) setOwn(pinnedValues, id, getOwn(values, id))
    for (const id of index.subBlocks.keys()) handled.add(id)
    for (const field of index.fields.values()) {
      const members = field.kind === 'pair' ? field.members : [field.sub]
      const declarations = members.flatMap(
        (member) => index.declarations.get(member.id) ?? [member]
      )
      if (!declarations.some(isWrittenInSource)) continue
      const typed = typedForBuilder(declarations, pinnedValues)
      if (field.kind === 'pair') {
        const mode: ParamMode = getOwn(block.modes, field.param) ?? 'basic'
        const member = memberFor(field, mode)
        if (!member) continue
        const effective = declarationFor(index, member.id, lookup) ?? member
        if (hasValue(block, effective.id)) {
          if (inactiveIds.has(effective.id)) continue
          if (mode === 'basic' && member === field.basic && isDefault(effective.id)) continue
          const printed = printParamValue(ctx, block, declared, effective.id, effective)
          if (printed) {
            if (typed) push(params, field.name, printed)
            else push(extra, effective.id, printed)
          }
        } else if (
          typed &&
          needsTodo(block, declared, effective, declarations, pinnedValues, values)
        ) {
          push(params, field.name, ctx.values.call('todo', []))
        } else if (
          field.members.some((member) => defaults.has(member.id)) &&
          activeIfSet(ctx, inputs(), effective, defaults.get(effective.id) ?? '')
        ) {
          if (typed) push(params, field.name, NULL_EXPR)
          else push(extra, effective.id, NULL_EXPR)
        }
        continue
      }
      const sb = declarationFor(index, field.sub.id, lookup) ?? field.sub
      if (!hasValue(block, sb.id)) {
        if (typed && needsTodo(block, declared, sb, declarations, pinnedValues, values)) {
          push(params, field.name, ctx.values.call('todo', []))
        } else {
          const fallback = defaults.get(sb.id)
          if (fallback !== undefined && activeIfSet(ctx, inputs(), sb, fallback)) {
            if (typed) push(params, field.name, NULL_EXPR)
            else push(extra, sb.id, NULL_EXPR)
          }
        }
        continue
      }
      if (inactiveIds.has(sb.id) || isDefault(sb.id)) continue
      // A JSON code field prints as an object literal only as a builder param: compile reads
      // `extra` verbatim, so there the stored text is written as text.
      const printed = printParamValue(ctx, block, declared, sb.id, sb, typed)
      if (printed) {
        if (typed) push(params, field.name, printed)
        else push(extra, sb.id, printed)
      }
    }
  }

  const rest = Object.keys(block.params)
    .filter((id) => !handled.has(id) && !inactiveIds.has(id))
    .sort(compareStrings)
  for (const id of rest) {
    const printed = printParamValue(ctx, block, declared, id, undefined)
    if (printed) push(declared ? extra : params, id, printed)
  }
  return { params, extra }
}

/**
 * The params of a response block printed in the `response(name, { body, status?, headers? })`
 * form (`forms/response.ts`): a numeric status as a number, header rows as a record.
 */
export function responseFormParams(
  ctx: PrintContext,
  block: CanonicalBlock,
  form: ResponseForm
): ParamEntry[] {
  const text = (value: string): Expr => ctx.values.value(value, { tag: 't', from: block.key })
  const entry = (key: string, expr: Expr): ParamEntry => ({
    key,
    anchor: anchors.param(block.key, key),
    value: expr,
  })
  const entries = [entry('body', printJsonField(ctx, block, form.data) ?? text(form.data))]
  if (form.status) {
    const { text: status, numeric } = form.status
    entries.push(
      entry(
        'status',
        numeric ? { doc: status, shape: 'number', numeric: true, depth: 2 } : text(status)
      )
    )
  }
  if (form.headers) {
    const headers = form.headers.map(({ name, value }) => ({
      key: printKey(name),
      value: text(value),
    }))
    entries.push(entry('headers', objectExpr(headers)))
  }
  return entries
}

/**
 * A field that prints `todo()` when it holds no stored value: one the builder's type requires
 * (`requiredForBuilder`) or requires in the variant the block's values select
 * (`requiredForValues`), or a required, always-shown field with no condition, default or not.
 */
function needsTodo(
  block: CanonicalBlock,
  declared: CatalogBlock,
  sb: CatalogSubBlock,
  declarations: readonly CatalogSubBlock[],
  pinned: Readonly<Record<string, unknown>>,
  values: Readonly<Record<string, unknown>>
): boolean {
  if (requiredForBuilder(declarations, pinned)) return true
  if (requiredForValues(declared, declarations, values)) return true
  if (sb.required !== true || sb.condition !== undefined || sb.hidden || sb.readOnly) return false
  if (sb.valueKind === 'none' || sb.valueKind === 'branches' || sb.valueKind === 'tools')
    return false
  if (block.triggerMode) return sb.mode === 'trigger'
  if (sb.mode === 'trigger') return declared.category === 'triggers'
  return sb.mode === undefined || sb.mode === 'basic' || sb.mode === 'both'
}

/** Param entries as object properties, each with its anchor's comments. */
export function paramProperties(ctx: PrintContext, entries: ParamEntry[]): Property[] {
  return entries.map((entry) => {
    const attached = ctx.comments.take(entry.anchor)
    return {
      key: entry.key,
      value: entry.value,
      leading: attached.leading,
      trailing: attached.trailing,
    }
  })
}
