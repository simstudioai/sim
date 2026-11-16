/**
 * `printWorkflow`: a canonical workflow → one TypeScript source file plus optional function-code
 * files (build-spec decisions 7–10, s3 D8–D12, s2 §2). Output is deterministic: the same input
 * prints byte-identical text, a one-param change touches one line, and the file is a Biome fixed
 * point.
 */

import { compareStrings } from '@sim/utils/string'
import {
  normalizeWorkflowBlockName,
  RESERVED_WORKFLOW_BLOCK_NAMES,
} from '@sim/workflow-types/workflow'
import { portKey } from '../anchors'
import type { LockHintBlock, LockHints, PrintInput, PrintResult, PrintWorkflowFn } from '../api'
import { canonicalActivityInputs, isInactive } from '../canonicalize/activity'
import { SUBFLOW_DATA_KEYS } from '../canonicalize/subflows'
import { type EditorDefault, editorDefaults } from '../catalog/defaults'
import type { BlockCatalog, CatalogBlock, CatalogBuilder, CatalogSubBlock } from '../catalog/types'
import {
  catalogBlock as catalogBlockOf,
  catalogBuilder,
  catalogBuilderPaths,
} from '../catalog/view'
import { type CodeFileCodec, type CodeFileLanguage, codeFileCodec } from '../code-files'
import type { PrintDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import { executableInactiveParams } from '../equivalence/executable'
import { isJson } from '../lock'
import type {
  AnchorKey,
  BlockKey,
  CanonicalBlock,
  CanonicalEdge,
  CanonicalTool,
  CanonicalWorkflow,
  Json,
  ParamMode,
  PortKey,
  Value,
} from '../model'
import { getOwn, setOwn } from '../records'
import { GENERIC_BUILDER } from '../sdk'
import { type AttachedComments, anchors, CommentPlacer, withComments } from './comments'
import { type Doc, group, hardline, ifBreak, indent, join, line, printDoc } from './doc'
import { assignIdentifiers } from './idents'
import { declarationOrder, type OrderDependency } from './order'
import { RefPrinter, type RefScope, referencedHeads } from './refs'
import { printKey, printMember, quoteString } from './strings'
import { arrayExpr, arrowExpr, callExpr, type Expr, objectExpr, type Property } from './syntax'
import { type FieldContext, type PrintedValue, type Tag, ValuePrinter } from './values'

const DEFAULT_WIDTH = 100
const DEFAULT_CODE_DIR = 'functions'
const ENTRY_PATH = 'workflow.ts'
const SDK_MODULE = '@sim/workflow-sdk'

const LANGUAGE_TAGS: Record<CodeFileLanguage, Tag> = { javascript: 'js', python: 'py', shell: 'sh' }
const LANGUAGE_EXTENSIONS: Record<CodeFileLanguage, string> = {
  javascript: 'js',
  python: 'py',
  shell: 'sh',
}

type Diag = Diagnostic<PrintDiagnosticCode>

function toLanguage(value: unknown): CodeFileLanguage | null {
  if (value === 'javascript' || value === 'js') return 'javascript'
  if (value === 'python' || value === 'py') return 'python'
  if (value === 'shell' || value === 'bash' || value === 'sh') return 'shell'
  return null
}

/** The advanced member of a basic/advanced pair, on either surface. */
function isAdvancedMember(sb: CatalogSubBlock): boolean {
  return sb.mode === 'advanced' || sb.mode === 'trigger-advanced'
}

function stringParam(block: CanonicalBlock, id: string): string | undefined {
  const param = getOwn(block.params, id)
  return param?.kind === 'value' && typeof param.value === 'string' ? param.value : undefined
}

/**
 * Whether compiling the effective member's value into `other` would store it differently. A
 * value the source writes as a list or object literal is stored as JSON text by a code member and
 * reshaped by an input-format member (`compile/blocks.ts` `compileField`); everything else lands
 * the same in either member, so which member holds it is UI state and a lean print leaves the mode
 * to the stored workflow.
 */
function storesDifferently(
  block: CanonicalBlock,
  effective: CatalogSubBlock | undefined,
  other: CatalogSubBlock | undefined
): boolean {
  const param = effective ? getOwn(block.params, effective.id) : undefined
  if (param?.kind !== 'value' || !other) return false
  const { value } = param
  const literal =
    Array.isArray(value) ||
    (value !== null && typeof value === 'object' && !Object.hasOwn(value, '$sim'))
  return literal && (other.type === 'code' || other.structured === 'inputFormat')
}

function hasValue(block: CanonicalBlock, id: string): boolean {
  return getOwn(block.params, id) !== undefined
}

function catalogBuilderEntries(catalog: BlockCatalog): Array<[string, CatalogBuilder]> {
  const entries: Array<[string, CatalogBuilder]> = []
  for (const path of catalogBuilderPaths(catalog)) {
    const builder = catalogBuilder(catalog, path)
    if (builder) entries.push([path, builder])
  }
  return entries
}

/**
 * The catalog builder for a block, most specific first (operation, then pinned fields). A
 * builder's params type one surface, so a trigger-mode builder never prints an action block and an
 * action builder never prints a block in trigger mode; such a block prints through `block()`. A
 * trigger block (`category: 'triggers'`) serializes both surfaces, so its builders fit either
 * stored mode.
 */
function findBuilder(
  catalog: BlockCatalog,
  type: string,
  triggerMode: boolean,
  read: (id: string) => string | undefined
): { path: string; builder: CatalogBuilder } | null {
  const triggerBlock = catalogBlockOf(catalog, type)?.category === 'triggers'
  const candidates = catalogBuilderEntries(catalog)
    .filter(([, builder]) => {
      if (builder.type !== type) return false
      if (!triggerBlock && (builder.triggerMode === true) !== triggerMode) return false
      if (builder.operation !== undefined && read('operation') !== builder.operation) return false
      return Object.entries(builder.fixed ?? {}).every(([id, value]) => read(id) === value)
    })
    .sort(([pathA, a], [pathB, b]) => {
      const modeA = (a.triggerMode === true) === triggerMode ? 0 : 1
      const modeB = (b.triggerMode === true) === triggerMode ? 0 : 1
      if (modeA !== modeB) return modeA - modeB
      const opA = a.operation === undefined ? 1 : 0
      const opB = b.operation === undefined ? 1 : 0
      if (opA !== opB) return opA - opB
      const fixedA = Object.keys(a.fixed ?? {}).length
      const fixedB = Object.keys(b.fixed ?? {}).length
      if (fixedA !== fixedB) return fixedB - fixedA
      return compareStrings(pathA, pathB)
    })
  const [first] = candidates
  return first ? { path: first[0], builder: first[1] } : null
}

function pinnedIds(builder: CatalogBuilder | undefined): Set<string> {
  const ids = new Set(Object.keys(builder?.fixed ?? {}))
  if (builder?.operation !== undefined) ids.add('operation')
  return ids
}

function kebab(ident: string): string {
  return ident
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

const INTEGER_LIKE = /^(0|[1-9][0-9]*)$/
const INPUT_FIELD_KEYS = new Set(['name', 'type', 'value', 'description', 'required'])

/**
 * The `inputFormat` record sugar (s2 §2): `{ subject: 'string' }` for `{ name, type, value: '' }`
 * items, `{ name: { type, value?, description?, required? } }` otherwise. `null` when any item
 * would not compile back to the same list (unknown keys, duplicate or integer-like names).
 */
function inputFormatSugar(
  value: Value
): Array<{ name: string; item: Record<string, Value> }> | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const seen = new Set<string>()
  const items: Array<{ name: string; item: Record<string, Value> }> = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || '$sim' in entry) {
      return null
    }
    const record = entry as Record<string, Value>
    const name = record.name
    if (typeof name !== 'string' || typeof record.type !== 'string') return null
    if (seen.has(name) || INTEGER_LIKE.test(name) || name === '__proto__') return null
    if (Object.keys(record).some((key) => !INPUT_FIELD_KEYS.has(key))) return null
    seen.add(name)
    items.push({ name, item: record })
  }
  return items
}

interface ScopeInfo {
  /** Declaration order of the scope's members. */
  members: BlockKey[]
}

/** One resolved param ready to print. */
interface ParamEntry {
  key: string
  anchor: AnchorKey
  value: Expr
}

/**
 * A tool entry as JSON for `raw(...)`. The CWM is JSON by contract (`canonicalHash` stringifies
 * it with `stableStringify`, which throws otherwise), so a non-JSON tool is a canonicalize bug.
 */
function toolJson(tool: CanonicalTool): Json {
  const value: unknown = tool
  if (!isJson(value)) throw new Error(`Tool entry of type "${tool.type}" is not plain JSON`)
  return value
}

class WorkflowPrinter {
  private readonly workflow: CanonicalWorkflow
  private readonly catalog: BlockCatalog
  private readonly hints: LockHints
  private readonly width: number
  private readonly options: PrintInput['options']
  /** `PrintOptions.verbose`: also print the preserved UI state source never needs. */
  private readonly verbose: boolean
  private readonly diagnostics: Diag[] = []
  private readonly imports = new Set<string>(['workflow'])
  private usesVars = false
  private readonly blocks: Map<BlockKey, CanonicalBlock>
  private readonly parentOf = new Map<BlockKey, BlockKey | null>()
  private readonly scopes = new Map<BlockKey | null, ScopeInfo>()
  private readonly position = new Map<BlockKey, number>()
  private readonly preorder: BlockKey[] = []
  private idents = new Map<BlockKey, string>()
  private readonly paramNames = new Map<BlockKey, string>()
  private readonly refs: RefPrinter
  private readonly values: ValuePrinter
  private readonly comments: CommentPlacer
  private readonly codeFiles: Array<{ path: string; text: string }> = []
  private readonly codeFileHints = new Map<BlockKey, string>()
  private readonly takenCodePaths = new Set<string>()

  constructor(
    input: PrintInput,
    private readonly codec: CodeFileCodec | undefined
  ) {
    this.workflow = input.workflow
    this.catalog = input.catalog
    this.hints = input.hints ?? { blocks: {} }
    this.width = input.options.lineWidth ?? DEFAULT_WIDTH
    this.options = input.options
    this.verbose = input.options.verbose === true
    this.blocks = new Map(Object.entries(this.workflow.blocks))
    for (const [key, block] of this.blocks) {
      const parent = block.parent === null ? undefined : this.blocks.get(block.parent)
      this.parentOf.set(key, parent?.subflow && block.parent !== null ? block.parent : null)
    }
    this.breakParentCycles()
    const scope: RefScope = {
      hasBlock: (key) => this.blocks.has(key),
      hasVariable: (key) => key in this.workflow.variables,
      visibility: (from, target) => this.visibility(from, target),
      identOf: (key) => this.idents.get(key) ?? key,
      loopParam: (from, kind) => this.loopParam(from, kind),
      use: (name) => this.imports.add(name),
      useVars: () => {
        this.usesVars = true
      },
    }
    this.refs = new RefPrinter(scope)
    this.values = new ValuePrinter(
      this.refs,
      (name) => this.imports.add(name),
      () => {
        this.usesVars = true
      },
      input.options.verbose === true
    )
    this.comments = new CommentPlacer(this.workflow.annotations.comments)
  }

  /** A parent chain that loops (corrupt input) is cut at the block that closes it. */
  private breakParentCycles(): void {
    for (const key of this.blocks.keys()) {
      const seen = new Set<BlockKey>([key])
      let current = this.parentOf.get(key) ?? null
      while (current !== null) {
        if (seen.has(current)) {
          this.parentOf.set(key, null)
          break
        }
        seen.add(current)
        current = this.parentOf.get(current) ?? null
      }
    }
  }

  private ancestors(key: BlockKey): BlockKey[] {
    const chain: BlockKey[] = []
    let current = this.parentOf.get(key) ?? null
    while (current !== null) {
      chain.push(current)
      current = this.parentOf.get(current) ?? null
    }
    return chain
  }

  /** The member of `target`'s scope that encloses `from` (or is `from`), if any. */
  private enclosingMember(from: BlockKey, target: BlockKey): BlockKey | null {
    const scope = this.parentOf.get(target) ?? null
    for (const candidate of [from, ...this.ancestors(from)]) {
      if ((this.parentOf.get(candidate) ?? null) === scope) return candidate
    }
    return null
  }

  private visibility(from: BlockKey, target: BlockKey): 'ok' | 'forward' | 'scope' {
    if (from === target) return 'forward'
    const member = this.enclosingMember(from, target)
    if (member === null) return 'scope'
    if (member === target) return 'ok'
    const a = this.position.get(target) ?? 0
    const b = this.position.get(member) ?? 0
    return a < b ? 'ok' : 'forward'
  }

  private loopParam(from: BlockKey, kind: 'loop' | 'parallel'): string | null {
    for (const ancestor of this.ancestors(from)) {
      if (this.blocks.get(ancestor)?.subflow?.kind === kind) {
        return this.paramNames.get(ancestor) ?? null
      }
    }
    return null
  }

  private isTrigger(block: CanonicalBlock): boolean {
    return block.triggerMode || catalogBlockOf(this.catalog, block.type)?.category === 'triggers'
  }

  private layout(): void {
    const dependencies: OrderDependency[] = []
    for (const [key, block] of this.blocks) {
      for (const head of this.blockRefHeads(block)) {
        if (!this.blocks.has(head) || head === key) continue
        const member = this.enclosingMember(key, head)
        if (member !== null && member !== head) {
          dependencies.push({ before: head, after: member, hard: true })
        }
      }
    }
    for (const edge of this.workflow.edges) {
      if (!this.blocks.has(edge.from) || !this.blocks.has(edge.to)) continue
      if ((this.parentOf.get(edge.from) ?? null) === (this.parentOf.get(edge.to) ?? null)) {
        dependencies.push({ before: edge.from, after: edge.to, hard: false })
      }
    }
    const membersOf = new Map<BlockKey | null, BlockKey[]>()
    for (const key of this.blocks.keys()) {
      const parent = this.parentOf.get(key) ?? null
      const list = membersOf.get(parent) ?? []
      list.push(key)
      membersOf.set(parent, list)
    }
    const visit = (scope: BlockKey | null) => {
      const keys = membersOf.get(scope) ?? []
      const order = declarationOrder(
        keys.map((key) => {
          const block = this.blocks.get(key)
          return {
            key,
            isTrigger: block ? this.isTrigger(block) : false,
            order: getOwn(this.hints.blocks, key)?.order,
          }
        }),
        dependencies
      )
      this.scopes.set(scope, { members: order })
      order.forEach((key, index) => {
        this.position.set(key, index)
        this.preorder.push(key)
        if (this.blocks.get(key)?.subflow) visit(key)
      })
    }
    visit(null)

    const reserved = new Set<string>()
    for (const path of catalogBuilderPaths(this.catalog)) {
      const [namespace] = path.split('.')
      if (namespace) reserved.add(namespace)
    }
    this.idents = assignIdentifiers(
      this.preorder.map((key) => ({
        key,
        name: this.blocks.get(key)?.name ?? key,
        hint: getOwn(this.hints.blocks, key)?.binding,
      })),
      reserved
    )
    const taken = new Set(this.idents.values())
    for (const key of this.preorder) {
      if (!this.blocks.get(key)?.subflow) continue
      const depth = this.ancestors(key).filter((a) => this.blocks.get(a)?.subflow).length + 1
      let name = depth === 1 ? 'p' : `p${depth}`
      while (taken.has(name)) name = `${name}_`
      this.paramNames.set(key, name)
    }
  }

  private blockRefHeads(block: CanonicalBlock): string[] {
    const heads: string[] = []
    const walk = (value: unknown) => {
      if (typeof value === 'string') heads.push(...referencedHeads(value))
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk)
    }
    for (const param of Object.values(block.params)) {
      if (param.kind === 'value') walk(param.value)
      else walk(param.tools.map((tool) => tool.params))
    }
    for (const row of block.branches?.rows ?? []) walk(row.value)
    if (block.subflow) walk(block.subflow)
    return heads
  }

  /** A trigger block (`category: 'triggers'`) serializes both surfaces (`shouldSerializeSubBlock`). */
  private surfaceSubBlocks(block: CanonicalBlock, catalogBlock: CatalogBlock): CatalogSubBlock[] {
    if (catalogBlock.category === 'triggers') return catalogBlock.subBlocks
    const surface = block.triggerMode ? 'trigger' : 'action'
    return catalogBlock.subBlocks.filter((sb) => sb.surface === undefined || sb.surface === surface)
  }

  private tagFor(
    block: CanonicalBlock,
    catalogBlock: CatalogBlock | undefined,
    sb?: CatalogSubBlock
  ): Tag {
    if (sb?.valueKind === 'code') {
      if (sb.language === 'json') return 'json'
      const language = toLanguage(stringParam(block, 'language')) ?? toLanguage(sb.language)
      return language ? LANGUAGE_TAGS[language] : 'js'
    }
    if (catalogBlock?.graph.annotationOnly) return 'md'
    return 't'
  }

  private context(
    block: CanonicalBlock,
    catalogBlock: CatalogBlock | undefined,
    sb?: CatalogSubBlock
  ): FieldContext {
    return {
      tag: this.tagFor(block, catalogBlock, sb),
      from: block.key,
      variablesField: sb?.structured === 'variables',
      ...(sb ? { subBlock: sb } : {}),
    }
  }

  private printParamValue(
    block: CanonicalBlock,
    catalogBlock: CatalogBlock | undefined,
    id: string,
    sb: CatalogSubBlock | undefined
  ): PrintedValue | null {
    const param = getOwn(block.params, id)
    if (!param) return null
    if (param.kind === 'tools') return this.printTools(block, param.tools)
    const context = this.context(block, catalogBlock, sb)
    if (sb?.structured === 'inputFormat' && Array.isArray(param.value)) {
      const sugar = inputFormatSugar(param.value)
      if (sugar) return this.printInputFormat(block, sugar)
      // The record form is the only one the SDK types: an empty list is `{}`, and a list the
      // record cannot carry (an integer-like or repeated name, an unknown key) is kept verbatim.
      if (param.value.length === 0) return objectExpr([])
      if (isJson(param.value)) return this.values.call('raw', [this.values.json(param.value)])
    }
    if (
      this.options.functionCode === 'files' &&
      sb?.valueKind === 'code' &&
      (context.tag === 'js' || context.tag === 'py' || context.tag === 'sh') &&
      typeof param.value === 'string' &&
      !this.codeFileHints.has(block.key)
    ) {
      const fileExpr = this.printCodeFile(block, param.value, context.tag)
      if (fileExpr) return fileExpr
    }
    return this.values.field(param.value, context)
  }

  private printInputFormat(
    block: CanonicalBlock,
    items: Array<{ name: string; item: Record<string, Value> }>
  ): PrintedValue {
    const nested: FieldContext = { tag: 't', from: block.key }
    return objectExpr(
      items.map(({ name, item }) => {
        const keys = Object.keys(item)
        const short =
          keys.length === 3 && 'value' in item && item.value === '' && typeof item.type === 'string'
        if (short && typeof item.type === 'string') {
          return { key: printKey(name), value: this.values.string(item.type) }
        }
        const properties: Property[] = []
        for (const field of ['type', 'value', 'description', 'required']) {
          const fieldValue = item[field]
          if (fieldValue === undefined) continue
          properties.push({ key: field, value: this.values.value(fieldValue, nested) })
        }
        return { key: printKey(name), value: objectExpr(properties) }
      })
    )
  }

  private printCodeFile(
    block: CanonicalBlock,
    code: string,
    tag: 'js' | 'py' | 'sh'
  ): PrintedValue | null {
    const language: CodeFileLanguage =
      tag === 'js' ? 'javascript' : tag === 'py' ? 'python' : 'shell'
    const inline = (reason: string): null => {
      this.diagnostics.push({
        code: 'W_CODE_FILE_INLINED',
        severity: 'warning',
        message: `Function code of ${block.name} printed inline: ${reason}.`,
        blockKey: block.key,
      })
      return null
    }
    const stored = stringParam(block, 'language') ?? 'javascript'
    if (stored !== language) return inline(`its language ${stored} has no code-file form`)
    if (!this.codec) return inline('no code-file codec is available')
    const text = this.codec.toFile(code, language)
    if (text === null) return inline('its tokens cannot be rewritten for a code file')
    if (this.codec.fromFile(text, language) !== code) {
      return inline('the code-file round trip did not reproduce the stored code')
    }
    const extension = LANGUAGE_EXTENSIONS[language]
    const hinted = getOwn(this.hints.blocks, block.key)?.codeFile
    const dir = (this.options.codeDir ?? DEFAULT_CODE_DIR).replace(/\/+$/, '')
    let path =
      hinted?.endsWith(`.${extension}`) && !this.takenCodePaths.has(hinted)
        ? hinted
        : `${dir}/${kebab(this.idents.get(block.key) ?? block.key)}.${extension}`
    let suffix = 2
    const base = path.slice(0, -(extension.length + 1))
    while (this.takenCodePaths.has(path)) {
      path = `${base}-${suffix}.${extension}`
      suffix += 1
    }
    this.takenCodePaths.add(path)
    this.codeFileHints.set(block.key, path)
    this.codeFiles.push({ path, text })
    return this.values.call('file', [{ doc: quoteString(`./${path}`), shape: 'string' }])
  }

  private printTools(block: CanonicalBlock, tools: CanonicalTool[]): PrintedValue {
    const elements = tools.map((tool) => {
      const catalogBlock = catalogBlockOf(this.catalog, tool.type)
      const found = findBuilder(this.catalog, tool.type, false, (id) => {
        if (id === 'operation') return tool.operation
        const value = getOwn(tool.params, id)
        return typeof value === 'string' ? value : undefined
      })
      if (!found) return this.values.call('raw', [this.values.json(toolJson(tool))])
      const pinned = pinnedIds(found.builder)
      const nested: FieldContext = { tag: 't', from: block.key }
      const params: Property[] = Object.entries(tool.params)
        .filter(([id]) => !pinned.has(id))
        .map(([id, value]) => {
          const sb = catalogBlock?.subBlocks.find((candidate) => candidate.id === id)
          return {
            key: printKey(id),
            value: sb
              ? this.values.field(value, { ...nested, subBlock: sb })
              : this.values.value(value, nested),
          }
        })
      const options: Property[] = []
      if (tool.operation !== undefined && !pinned.has('operation')) {
        options.push({ key: 'operation', value: this.values.string(tool.operation) })
      }
      if (tool.toolId !== undefined)
        options.push({ key: 'toolId', value: this.values.string(tool.toolId) })
      if (tool.title !== undefined)
        options.push({ key: 'title', value: this.values.string(tool.title) })
      if (tool.usageControl !== undefined) {
        options.push({ key: 'usageControl', value: this.values.string(tool.usageControl) })
      }
      if (tool.usageControlExpression !== undefined) {
        options.push({
          key: 'usageControlExpression',
          value: this.values.value(tool.usageControlExpression, { tag: 'js', from: block.key }),
        })
      }
      if (Object.keys(tool.modes).length > 0) {
        options.push({ key: 'modes', value: this.modesExpr(tool.modes) })
      }
      if (tool.customTool !== undefined) {
        options.push({
          key: 'customTool',
          value: this.values.value(tool.customTool as Value, nested),
        })
      }
      if (tool.operationPolicy !== undefined) {
        options.push({ key: 'operationPolicy', value: this.values.json(tool.operationPolicy) })
      }
      if (tool.extra !== undefined && Object.keys(tool.extra).length > 0) {
        options.push({ key: 'extra', value: this.values.json(tool.extra) })
      }
      const segments = found.path.split('.')
      const method = segments.pop()
      const callee =
        segments.length === 0 ? `${method}.tool` : `${segments.join('.')}.tool.${method}`
      const args: Expr[] = [objectExpr(params)]
      if (options.length > 0) args.push(objectExpr(options))
      return this.values.call(callee, args)
    })
    return arrayExpr(elements)
  }

  private modesExpr(modes: Record<string, ParamMode>): Expr {
    return objectExpr(
      Object.keys(modes)
        .sort(compareStrings)
        .map((cid) => ({
          key: printKey(cid),
          value: this.values.string(getOwn(modes, cid) ?? 'basic'),
        }))
    )
  }

  /**
   * The ids of a block that never reach execution. A lean print uses the executable view's rule
   * (`executableInactiveParams`, shared with materialize); a verbose print lists the stored
   * annotation, so it shows exactly what canonicalize kept.
   */
  private inactiveIds(block: CanonicalBlock, catalogBlock: CatalogBlock | undefined): Set<string> {
    if (this.verbose) return new Set(getOwn(this.workflow.annotations.inactive, block.key) ?? [])
    return catalogBlock ? new Set(executableInactiveParams(block, this.catalog)) : new Set()
  }

  /**
   * Whether a field with no stored value would reach execution holding `value`, the editor
   * default compile fills in when the field is omitted. An absent field prints `null` only then:
   * an inactive one is restored from the stored workflow either way. The value matters for a
   * standalone advanced field, which is sent only when it holds one.
   */
  private activeIfSet(
    block: CanonicalBlock,
    catalogBlock: CatalogBlock,
    sb: CatalogSubBlock,
    value: Value
  ): boolean {
    const filled: CanonicalBlock = {
      ...block,
      params: { ...block.params, [sb.id]: { kind: 'value', value } },
    }
    return !isInactive(sb.id, canonicalActivityInputs(filled, catalogBlock, this.catalog))
  }

  /**
   * Params in catalog registry order, one per canonical pair (build-spec decision 7), under the
   * defaults rule: a value equal to the editor default (`editorDefaults`) is omitted, and an
   * active field with no stored value prints `null` when a default exists. A lean print leaves out
   * what never executes (inactive values, the pair member the mode hides, undeclared ids that do
   * not run); a verbose print lists them under `inactive` so nothing is lost (build-spec decision
   * 2), with the modes derivation would get wrong.
   */
  private collectParams(
    block: CanonicalBlock,
    catalogBlock: CatalogBlock | undefined,
    pinned: Set<string>
  ): { params: ParamEntry[]; inactive: ParamEntry[]; modes: Record<string, ParamMode> } {
    const params: ParamEntry[] = []
    const inactive: ParamEntry[] = []
    const modes: Record<string, ParamMode> = {}
    const handled = new Set<string>(pinned)
    const branchId = catalogBlock?.graph.branches?.subBlockId
    if (branchId) handled.add(branchId)
    const inactiveIds = this.inactiveIds(block, catalogBlock)
    const defaults: ReadonlyMap<string, EditorDefault> = catalogBlock
      ? editorDefaults(catalogBlock)
      : new Map()
    const pushInactive = (id: string, sb: CatalogSubBlock | undefined) => {
      if (!this.verbose) return
      const value = this.printParamValue(block, catalogBlock, id, sb)
      if (value)
        inactive.push({ key: printKey(id), anchor: anchors.inactive(block.key, id), value })
    }
    const pushNull = (key: string) => {
      params.push({
        key: printKey(key),
        anchor: anchors.param(block.key, key),
        value: { doc: 'null', shape: 'literal' },
      })
    }
    const isDefault = (id: string) => {
      const param = getOwn(block.params, id)
      return param?.kind === 'value' && defaults.has(id) && defaults.get(id) === param.value
    }

    if (catalogBlock) {
      const subBlocks = this.surfaceSubBlocks(block, catalogBlock)
      const seenCids = new Set<string>()
      for (const sb of subBlocks) {
        if (handled.has(sb.id)) continue
        const cid = sb.canonicalParamId
        if (cid !== undefined) {
          if (seenCids.has(cid)) continue
          seenCids.add(cid)
          const members = subBlocks.filter((m) => m.canonicalParamId === cid && !pinned.has(m.id))
          const mode: ParamMode = getOwn(block.modes, cid) ?? 'basic'
          const basic = members.find((m) => !isAdvancedMember(m))
          const advanced = members.find(isAdvancedMember)
          const effective = (mode === 'advanced' ? advanced : basic) ?? members[0]
          let printed: PrintedValue | null = null
          let elided = false
          for (const member of members) {
            if (handled.has(member.id)) continue
            handled.add(member.id)
            if (!hasValue(block, member.id)) continue
            if (member === effective && !inactiveIds.has(member.id)) {
              if (mode === 'basic' && member === basic && isDefault(member.id)) {
                elided = true
                continue
              }
              printed = this.printParamValue(block, catalogBlock, member.id, member)
              if (printed) {
                params.push({
                  key: printKey(cid),
                  anchor: anchors.param(block.key, cid),
                  value: printed,
                })
              }
            } else {
              pushInactive(member.id, member)
            }
          }
          if (
            !printed &&
            !elided &&
            effective &&
            !hasValue(block, effective.id) &&
            members.some((member) => defaults.has(member.id)) &&
            this.activeIfSet(block, catalogBlock, effective, defaults.get(effective.id) ?? '')
          ) {
            pushNull(cid)
          }
          const implied: ParamMode = printed ? (printed.selector ? 'basic' : 'advanced') : 'basic'
          if (
            basic &&
            advanced &&
            implied !== mode &&
            (this.verbose ||
              storesDifferently(block, effective, implied === 'basic' ? basic : advanced))
          ) {
            setOwn(modes, cid, mode)
          }
          continue
        }
        handled.add(sb.id)
        if (!hasValue(block, sb.id)) {
          if (this.needsTodo(block, sb)) {
            params.push({
              key: printKey(sb.id),
              anchor: anchors.param(block.key, sb.id),
              value: this.values.call('todo', []),
            })
          } else {
            const fallback = defaults.get(sb.id)
            if (fallback !== undefined && this.activeIfSet(block, catalogBlock, sb, fallback)) {
              pushNull(sb.id)
            }
          }
          continue
        }
        if (inactiveIds.has(sb.id)) {
          pushInactive(sb.id, sb)
          continue
        }
        if (isDefault(sb.id)) continue
        const printed = this.printParamValue(block, catalogBlock, sb.id, sb)
        if (printed) {
          params.push({
            key: printKey(sb.id),
            anchor: anchors.param(block.key, sb.id),
            value: printed,
          })
        }
      }
    }

    const rest = Object.keys(block.params)
      .filter((id) => !handled.has(id))
      .sort(compareStrings)
    for (const id of rest) {
      if (!catalogBlock) {
        const printed = this.printParamValue(block, undefined, id, undefined)
        if (printed) {
          params.push({ key: printKey(id), anchor: anchors.param(block.key, id), value: printed })
        }
        continue
      }
      // `inactive` is the only place source takes an id the catalog does not declare on this
      // surface. A lean print keeps only the ones that still run: a schema-agnostic custom
      // block's inputs and the agent's legacy prompt fields.
      if (!this.verbose && inactiveIds.has(id)) continue
      const value = this.printParamValue(block, catalogBlock, id, undefined)
      if (value) {
        inactive.push({ key: printKey(id), anchor: anchors.inactive(block.key, id), value })
      }
    }
    if (this.verbose) {
      for (const cid of Object.keys(block.modes).sort(compareStrings)) {
        const handledCid =
          catalogBlock?.subBlocks.some((sb) => sb.canonicalParamId === cid) ?? false
        if (!handledCid) setOwn(modes, cid, getOwn(block.modes, cid) ?? 'basic')
      }
    }
    return { params, inactive, modes }
  }

  /** A required, always-visible field with no stored value prints `todo()` (s2 D7). */
  private needsTodo(block: CanonicalBlock, sb: CatalogSubBlock): boolean {
    if (sb.required !== true || sb.condition !== undefined || sb.hidden || sb.readOnly) return false
    if (sb.valueKind === 'none' || sb.valueKind === 'branches' || sb.valueKind === 'tools')
      return false
    if (block.triggerMode) return sb.mode === 'trigger'
    if (sb.mode === 'trigger')
      return catalogBlockOf(this.catalog, block.type)?.category === 'triggers'
    return sb.mode === undefined || sb.mode === 'basic' || sb.mode === 'both'
  }

  private paramProperties(entries: ParamEntry[]): Property[] {
    return entries.map((entry) => {
      const attached = this.comments.take(entry.anchor)
      return {
        key: entry.key,
        value: entry.value,
        leading: attached.leading,
        trailing: attached.trailing,
      }
    })
  }

  private hasErrorEdge(key: BlockKey): boolean {
    return this.workflow.edges.some((edge) => edge.from === key && edge.port.kind === 'error')
  }

  private metaProperties(
    block: CanonicalBlock,
    extra: {
      triggerMode?: boolean | undefined
      modes: Record<string, ParamMode>
      inactive: Property[]
      branches?: Property[]
    }
  ): Property[] {
    const meta: Property[] = []
    const yes: Expr = { doc: 'true', shape: 'literal' }
    if (needsKeyOverride(block)) meta.push({ key: 'key', value: this.values.string(block.key) })
    if (!block.enabled) meta.push({ key: 'disabled', value: yes })
    if (block.locked) meta.push({ key: 'locked', value: yes })
    if (block.advancedMode) meta.push({ key: 'advancedMode', value: yes })
    if (extra.triggerMode !== undefined) {
      meta.push({ key: 'triggerMode', value: { doc: String(extra.triggerMode), shape: 'literal' } })
    }
    if (block.errorPort && !this.hasErrorEdge(block.key))
      meta.push({ key: 'errorPort', value: yes })
    if (block.retry) meta.push({ key: 'retry', value: this.values.json({ ...block.retry }) })
    if (Object.keys(extra.modes).length > 0)
      meta.push({ key: 'modes', value: this.modesExpr(extra.modes) })
    if (extra.branches && extra.branches.length > 0) {
      meta.push({ key: 'branches', value: objectExpr(extra.branches) })
    }
    if (extra.inactive.length > 0) meta.push({ key: 'inactive', value: objectExpr(extra.inactive) })
    const opaque = this.printedOpaque(block)
    if (opaque && Object.keys(opaque).length > 0) {
      meta.push({ key: '$unknown', value: this.values.json(opaque) })
    }
    return meta
  }

  /**
   * The unknown `block.data` a print carries as `$unknown`. Nothing executes it, so a lean print
   * keeps only a container's subflow keys canonicalize could not read as config, which the
   * serializer passes through with the container's data; a verbose print keeps all of it.
   */
  private printedOpaque(block: CanonicalBlock): Record<string, Json> | undefined {
    const opaque = block.opaque?.data
    if (!opaque || this.verbose) return opaque
    if (!block.subflow) return undefined
    const kept: Record<string, Json> = {}
    for (const [key, value] of Object.entries(opaque)) {
      if (SUBFLOW_DATA_KEYS.has(key)) setOwn(kept, key, value)
    }
    return kept
  }

  /** Branch rows as named keys, plus per-row title overrides and extra keys for the meta. */
  private branchEntries(block: CanonicalBlock): { entries: Property[]; meta: Property[] } {
    const branches = block.branches
    if (!branches?.rows) return { entries: [], meta: [] }
    const entries: Property[] = []
    const meta: Property[] = []
    const rows = branches.rows
    rows.forEach((row, index) => {
      const isElse =
        branches.kind === 'condition' && row.key === 'else' && index === rows.length - 1
      const value: Expr =
        isElse && row.value === ''
          ? { doc: 'true', shape: 'literal' }
          : this.values.value(row.value, {
              tag: branches.kind === 'condition' ? 'js' : 't',
              from: block.key,
            })
      entries.push({ key: printMember(row.key).slice(1), value })
      const rowMeta: Property[] = []
      if (row.titleOverride !== undefined) {
        rowMeta.push({ key: 'title', value: this.values.string(row.titleOverride) })
      }
      if (row.extra && Object.keys(row.extra).length > 0) {
        rowMeta.push({ key: 'extra', value: this.values.json(row.extra) })
      }
      if (rowMeta.length > 0) meta.push({ key: printKey(row.key), value: objectExpr(rowMeta) })
    })
    return { entries, meta }
  }

  private blockCall(block: CanonicalBlock): Expr {
    if (block.subflow) return this.containerCall(block)
    const catalogBlock = catalogBlockOf(this.catalog, block.type)
    const found = findBuilder(this.catalog, block.type, block.triggerMode, (id) =>
      stringParam(block, id)
    )
    const pinned = pinnedIds(found?.builder)
    const { params, inactive, modes } = this.collectParams(block, catalogBlock, pinned)
    const paramProps = this.paramProperties(params)
    const inactiveProps = this.paramProperties(inactive)
    const branchKind = catalogBlock?.graph.branches?.kind ?? block.branches?.kind
    const { entries: branchProps, meta: branchMeta } = this.branchEntries(block)
    const branchSubBlock =
      catalogBlock?.graph.branches?.subBlockId ??
      (branchKind === 'router' ? 'routes' : 'conditions')

    let generic = found === null
    let topLevel: Property[] = paramProps
    if (block.branches) {
      const collides = paramProps.some((prop) =>
        branchProps.some((branch) => branch.key === prop.key)
      )
      if (branchKind === 'condition' && !generic && !collides) {
        topLevel = [...branchProps, ...paramProps]
      } else {
        if (branchKind === 'condition' && collides) generic = true
        topLevel = [
          ...paramProps,
          { key: printKey(branchSubBlock), value: objectExpr(branchProps) },
        ]
      }
    }
    let triggerMode: boolean | undefined
    if (generic) triggerMode = block.triggerMode ? true : undefined
    else if ((found?.builder.triggerMode === true) !== block.triggerMode)
      triggerMode = block.triggerMode
    const meta = this.metaProperties(block, {
      triggerMode,
      modes,
      inactive: inactiveProps,
      branches: branchMeta,
    })
    const args: Expr[] = []
    let callee = found?.path ?? GENERIC_BUILDER
    if (generic) {
      callee = GENERIC_BUILDER
      args.push(this.values.string(block.type))
      if (found) {
        topLevel = this.paramProperties(
          [...pinned].sort(compareStrings).flatMap((id) => {
            const value = getOwn(block.params, id)
            return value?.kind === 'value'
              ? [
                  {
                    key: printKey(id),
                    anchor: anchors.param(block.key, id),
                    value: this.values.value(value.value, this.context(block, catalogBlock)),
                  },
                ]
              : []
          })
        ).concat(topLevel)
      }
    }
    args.push(this.values.string(block.name), objectExpr(topLevel))
    if (meta.length > 0) args.push(objectExpr(meta))
    return this.values.call(callee, args)
  }

  private containerCall(block: CanonicalBlock): Expr {
    const spec = block.subflow
    if (!spec) throw new Error('containerCall requires a subflow block')
    const config: Property[] = []
    const inactive: Property[] = []
    const field = (
      name: string,
      key: string,
      value: Json | undefined,
      active: boolean,
      tag: Tag
    ) => {
      if (value === undefined) return
      if (!active && !this.verbose) return
      const printed = this.values.value(value, { tag, from: block.key })
      if (active) {
        config.push({ key, value: printed })
      } else {
        const attached = this.comments.take(anchors.inactive(block.key, name))
        inactive.push({ key: name, value: printed, ...attached })
      }
    }
    let callee: string
    if (spec.kind === 'loop') {
      callee = `loop.${spec.loopType}`
      const countRuns =
        spec.loopType === 'for' || (spec.loopType === 'doWhile' && !spec.doWhileCondition)
      field('iterations', 'count', spec.iterations, countRuns, 't')
      field('forEachItems', 'collection', spec.forEachItems, spec.loopType === 'forEach', 't')
      field('whileCondition', 'condition', spec.whileCondition, spec.loopType === 'while', 'js')
      field(
        'doWhileCondition',
        'condition',
        spec.doWhileCondition,
        spec.loopType === 'doWhile',
        'js'
      )
    } else {
      const type = spec.parallelType
      callee = type === undefined ? 'parallel' : `parallel.${type}`
      field('count', 'count', spec.count, type !== 'collection', 't')
      field('distribution', 'collection', spec.distribution, type !== 'count', 't')
      field('batchSize', 'batchSize', spec.batchSize, true, 't')
    }
    const catalogBlock = catalogBlockOf(this.catalog, block.type)
    const {
      params,
      inactive: inactiveParams,
      modes,
    } = this.collectParams(block, catalogBlock, new Set())
    const extraInactive = this.paramProperties([...params, ...inactiveParams])
    const meta = this.metaProperties(block, { modes, inactive: [...inactive, ...extraInactive] })
    const body = this.scopeStatements(block.key)
    const args: Expr[] = [
      this.values.string(block.name),
      objectExpr(config),
      arrowExpr(this.paramNames.get(block.key) ?? 'p', body),
    ]
    if (meta.length > 0) args.push(objectExpr(meta))
    return this.values.call(callee, args)
  }

  private identExpr(key: BlockKey): Expr {
    return { doc: this.idents.get(key) ?? key, shape: 'identifier' }
  }

  private wiring(scope: BlockKey | null): Array<{ doc: Doc; anchor: AnchorKey; source: BlockKey }> {
    const statements: Array<{ doc: Doc; anchor: AnchorKey; source: BlockKey }> = []
    const byTarget = (a: CanonicalEdge, b: CanonicalEdge) =>
      (this.position.get(a.to) ?? 0) - (this.position.get(b.to) ?? 0) ||
      this.preorder.indexOf(a.to) - this.preorder.indexOf(b.to)
    const call = (head: string, targets: CanonicalEdge[], method: string): Doc =>
      callExpr(
        `${head}.${method}`,
        [...targets].sort(byTarget).map((edge) => this.identExpr(edge.to))
      ).doc
    const raw = (source: BlockKey, handle: string, target: BlockKey): Doc => {
      this.diagnostics.push({
        code: 'W_RAW_HANDLE',
        severity: 'warning',
        message: `Edge handle ${handle} has no SDK form; printed as edge().`,
        blockKey: source,
      })
      return this.values.call('edge', [
        this.identExpr(source),
        this.values.string(handle),
        this.identExpr(target),
      ]).doc
    }

    if (scope !== null) {
      const container = this.blocks.get(scope)
      const starts = this.workflow.edges.filter(
        (e) => e.from === scope && e.port.kind === 'subflowStart'
      )
      if (container?.subflow && starts.length > 0) {
        statements.push({
          doc: call(this.paramNames.get(scope) ?? 'p', starts, 'to'),
          anchor: anchors.edges(scope, 'subflowStart'),
          source: scope,
        })
      }
    }

    for (const source of this.scopes.get(scope)?.members ?? []) {
      const block = this.blocks.get(source)
      if (!block) continue
      const ident = this.idents.get(source) ?? source
      const edges = this.workflow.edges.filter(
        (edge) => edge.from === source && this.blocks.has(edge.to)
      )
      const isContainer = block.subflow !== undefined
      const hasBranches =
        block.branches !== undefined ||
        catalogBlockOf(this.catalog, block.type)?.graph.branches !== undefined
      const groups = new Map<PortKey, CanonicalEdge[]>()
      for (const edge of edges) {
        const key = portKey(edge.port)
        const list = groups.get(key) ?? []
        list.push(edge)
        groups.set(key, list)
      }
      const rowOrder = (block.branches?.rows ?? []).map((row) => `branch:${row.key}`)
      const portOrder = (key: string): [number, number, string] => {
        if (key === 'out') return [0, 0, key]
        if (key === 'subflowEnd') return [1, 0, key]
        if (key.startsWith('branch:')) {
          const index = rowOrder.indexOf(key)
          return [2, index === -1 ? rowOrder.length : index, key]
        }
        if (key === 'error') return [3, 0, key]
        if (key === 'subflowStart') return [5, 0, key]
        return [4, 0, key]
      }
      const ports = [...groups.keys()].sort((a, b) => {
        const [ga, ia, ka] = portOrder(a)
        const [gb, ib, kb] = portOrder(b)
        return ga - gb || ia - ib || compareStrings(ka, kb)
      })
      for (const port of ports) {
        const targets = groups.get(port) ?? []
        const anchor = anchors.edges(source, port)
        const first = targets[0]
        if (!first) continue
        const kind = first.port
        if (kind.kind === 'subflowStart') {
          if (isContainer) continue
          for (const edge of targets) {
            statements.push({ doc: raw(source, 'loop-start-source', edge.to), anchor, source })
          }
          continue
        }
        if (kind.kind === 'raw' || (kind.kind === 'out' && (isContainer || hasBranches))) {
          const handle = kind.kind === 'raw' ? kind.handle : 'source'
          for (const edge of [...targets].sort(byTarget)) {
            statements.push({ doc: raw(source, handle, edge.to), anchor, source })
          }
          continue
        }
        if (kind.kind === 'subflowEnd' && !isContainer) {
          for (const edge of [...targets].sort(byTarget)) {
            statements.push({ doc: raw(source, 'loop-end-source', edge.to), anchor, source })
          }
          continue
        }
        if (kind.kind === 'error') {
          statements.push({ doc: call(ident, targets, 'onError'), anchor, source })
        } else if (kind.kind === 'branch') {
          statements.push({
            doc: call(`${ident}${printMember(kind.key)}`, targets, 'to'),
            anchor,
            source,
          })
        } else {
          statements.push({ doc: call(ident, targets, 'to'), anchor, source })
        }
      }
    }
    return statements
  }

  /** Declarations then wiring for one scope (the workflow body or a container callback). */
  private scopeStatements(scope: BlockKey | null): Doc[] {
    const members = this.scopes.get(scope)?.members ?? []
    const calls = members.map((key) => {
      const block = this.blocks.get(key)
      return block ? { key, call: this.blockCall(block) } : null
    })
    const wiring = this.wiring(scope)
    const wiringDocs: Doc[] = []
    wiring.forEach((statement, index) => {
      const seenBefore = wiring.slice(0, index).some((s) => s.anchor === statement.anchor)
      const attached: AttachedComments = seenBefore
        ? { leading: [], trailing: [] }
        : this.comments.take(statement.anchor)
      if (index === 0 && scope === null) {
        const wiringComments = this.comments.take(anchors.wiring)
        attached.leading.unshift(...wiringComments.leading)
        attached.trailing.push(...wiringComments.trailing)
      }
      wiringDocs.push(withComments(statement.doc, attached))
    })
    const declarations: Doc[] = []
    for (const entry of calls) {
      if (!entry) continue
      const { key, call } = entry
      const own = this.comments.take(anchors.block(key))
      const moved = this.comments.takeOrphans(key)
      const attached: AttachedComments = {
        leading: [...own.leading, ...moved.leading],
        trailing: [...own.trailing, ...moved.trailing],
      }
      declarations.push(
        withComments(['const ', this.idents.get(key) ?? key, ' = ', call.doc], attached)
      )
    }
    if (scope === null && wiring.length === 0) {
      const dangling = this.comments.take(anchors.wiring)
      for (const comment of [...dangling.leading, ...dangling.trailing]) wiringDocs.push(comment)
    }
    if (declarations.length > 0 && wiringDocs.length > 0)
      return [...declarations, '', ...wiringDocs]
    return [...declarations, ...wiringDocs]
  }

  print(): PrintResult {
    this.layout()
    const body = this.scopeStatements(null)
    const options: Property[] = []
    const { description } = this.workflow.meta
    if (description !== null)
      options.push({ key: 'description', value: this.values.string(description) })
    const variables = Object.values(this.workflow.variables).sort((a, b) =>
      compareStrings(a.key, b.key)
    )
    if (variables.length > 0) {
      options.push({
        key: 'variables',
        value: objectExpr(
          variables.map((variable) => {
            const fields: Property[] = []
            if (variable.name !== variable.key) {
              fields.push({ key: 'name', value: this.values.string(variable.name) })
            }
            fields.push({ key: 'type', value: this.values.string(variable.type) })
            fields.push({ key: 'value', value: this.values.json(variable.value) })
            const attached = this.comments.take(anchors.variable(variable.key))
            return { key: printKey(variable.key), value: objectExpr(fields), ...attached }
          })
        ),
      })
    }
    const callback = arrowExpr(this.usesVars ? '{ vars }' : '', body)
    const workflowCall = this.values.call('workflow', [
      this.values.string(this.workflow.meta.name),
      objectExpr(options),
      callback,
    ])

    for (const key of this.preorder) this.comments.takeOrphans(key)
    const header = this.comments.take(anchors.header)
    const footer = this.comments.take(anchors.footer)
    this.comments.dropRemaining()

    const importNames = [...this.imports].sort(compareImportNames)
    const importLine = group([
      'import {',
      indent([line, join([',', line], importNames)]),
      ifBreak(','),
      line,
      `} from '${SDK_MODULE}'`,
    ])
    const parts: Doc[] = [
      `// @sim-sdk ${this.catalog.sdkMajor}`,
      hardline,
      withComments(importLine, header),
      hardline,
      hardline,
      'export default ',
      workflowCall.doc,
      footer.trailing,
    ]
    if (footer.leading.length > 0) parts.push(hardline, join(hardline, footer.leading))
    parts.push(hardline)
    const text = printDoc(parts, this.width)

    const hintBlocks: Record<BlockKey, LockHintBlock> = { ...this.hints.blocks }
    this.preorder.forEach((key, index) => {
      const codeFile = this.codeFileHints.get(key)
      setOwn(hintBlocks, key, {
        binding: this.idents.get(key) ?? key,
        order: index,
        ...(codeFile ? { codeFile } : {}),
      })
    })
    return {
      files: [{ path: ENTRY_PATH, text }, ...this.codeFiles],
      hints: { blocks: hintBlocks },
      diagnostics: [...this.refs.diagnostics, ...this.diagnostics, ...this.comments.diagnostics],
    }
  }
}

const RESERVED_KEYS: ReadonlySet<string> = new Set(RESERVED_WORKFLOW_BLOCK_NAMES)

/**
 * A legacy key the display name cannot carry: a `name~n` collision key, or a reserved name
 * (`Loop`, `Parallel`). Printed as `meta.key`, which the compiler accepts only for a key the
 * stored workflow already has (`CompileInput.knownKeys`).
 */
function needsKeyOverride(block: CanonicalBlock): boolean {
  return block.key !== normalizeWorkflowBlockName(block.name) || RESERVED_KEYS.has(block.key)
}

/** Import specifiers in the order Biome's organizeImports keeps them. */
function compareImportNames(a: string, b: string): number {
  return compareStrings(a, b)
}

/**
 * Creates a printer that writes function code to files through `codec`. Without a codec, files
 * mode prints every function body inline with `W_CODE_FILE_INLINED`.
 */
export function createPrintWorkflow(codec?: CodeFileCodec): PrintWorkflowFn {
  return (input) => new WorkflowPrinter(input, codec).print()
}

/** The printer with the code-files bijection (`codeFileCodec`), so files mode works as is. */
export const printWorkflow: PrintWorkflowFn = createPrintWorkflow(codeFileCodec)
