/**
 * `printWorkflow`: a canonical workflow → one TypeScript source file plus optional function-code
 * files. Output is deterministic: the same input
 * prints byte-identical text, a one-param change touches one line, and the file is a Biome fixed
 * point.
 */

import { compareStrings } from '@sim/utils/string'
import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import {
  isReservedWorkflowBlockName,
  normalizeWorkflowBlockName,
} from '@sim/workflow-types/workflow'
import {
  type McpToolForm,
  readMcpTool,
  readWorkflowTool,
  type WorkflowToolForm,
} from '../agent-tools'
import { portKey } from '../anchors'
import { SUBFLOW_DATA_KEYS } from '../canonicalize/subflows'
import { canonicalActivityInputs, executableInactiveParams, isInactive } from '../catalog/activity'
import { type EditorDefault, editorDefaults } from '../catalog/defaults'
import { buildFieldIndex, memberFor, paramAliases } from '../catalog/surface'
import type { BlockCatalog, CatalogBlock, CatalogBuilder, CatalogSubBlock } from '../catalog/types'
import { catalogBlock, catalogBuilderPaths, catalogBuildersOfType } from '../catalog/view'
import { type CodeFileLanguage, checkCodeFileBijection } from '../code-files'
import type { PrintDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import { branchesAtTopLevel, printsAsElseTrue } from '../forms/condition'
import { inputFormatSugar } from '../forms/input-format'
import { type ResponseForm, readResponseForm } from '../forms/response'
import {
  JsonRef,
  type JsonTree,
  jsonFieldText,
  parseJsonField,
  type RefTypeScope,
  refValueKind,
} from '../json-fields'
import { CODE_FILE_EXTENSIONS, SOURCE_CODE_DIR, SOURCE_ENTRY_FILE } from '../limits'
import { isJson, type SourceHintBlock, type SourceHints } from '../lock'
import {
  type AnchorKey,
  type BlockKey,
  type CanonicalBlock,
  type CanonicalEdge,
  type CanonicalTool,
  type CanonicalWorkflow,
  isPlainRecord,
  type Json,
  type ParamMode,
  type PortKey,
  type Value,
} from '../model'
import { getOwn, setOwn } from '../records'
import { CUSTOM_TOOL_TYPE, GENERIC_BUILDER, RESPONSE_BLOCK_TYPE } from '../sdk'
import { type AttachedComments, anchors, CommentPlacer, withComments } from './comments'
import { type Doc, group, hardline, ifBreak, indent, join, line, printDoc } from './doc'
import { assignIdentifiers } from './idents'
import { declarationOrder, type OrderDependency } from './order'
import { RefPrinter, type RefScope, referencedHeads } from './refs'
import { printKey, printMember } from './strings'
import {
  arrayExpr,
  arrowExpr,
  callExpr,
  type Expr,
  objectExpr,
  type Property,
  pathDepth,
  type StatementList,
} from './syntax'
import { type FieldContext, type PrintedValue, refExpr, type Tag, ValuePrinter } from './values'

interface PrintOptions {
  /** `files`: function code in `functions/` code files (repo mode); `inline`: `js``...``. */
  functionCode: 'inline' | 'files'
}

export interface PrintInput {
  workflow: CanonicalWorkflow
  catalog: BlockCatalog
  hints?: SourceHints
  options: PrintOptions
}

interface PrintedFile {
  path: string
  text: string
}

interface PrintResult {
  /** The workflow file first, then code files. */
  files: [PrintedFile, ...PrintedFile[]]
  /** Input hints plus an ident, order and code file for every block. */
  hints: SourceHints
  diagnostics: Diagnostic<PrintDiagnosticCode>[]
  /**
   * An upper bound on the depth of the workflow file's Babel syntax tree, the measure compile
   * caps at `SOURCE_LIMITS.maxDepth`: a print under the cap needs no parse to know it fits.
   */
  entryDepth: number
}

/** biome.json's line width. */
const LINE_WIDTH = 100
const SDK_MODULE = '@sim/workflow-sdk'

type Diag = Diagnostic<PrintDiagnosticCode>

function toLanguage(value: unknown): CodeFileLanguage | null {
  if (value === 'javascript' || value === 'js') return 'javascript'
  if (value === 'python' || value === 'py') return 'python'
  if (value === 'shell' || value === 'bash' || value === 'sh') return 'shell'
  return null
}

function stringParam(block: CanonicalBlock, id: string): string | undefined {
  const param = getOwn(block.params, id)
  return param?.kind === 'value' && typeof param.value === 'string' ? param.value : undefined
}

function hasValue(block: CanonicalBlock, id: string): boolean {
  return getOwn(block.params, id) !== undefined
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
  const triggerBlock = catalogBlock(catalog, type)?.category === 'triggers'
  const candidates = catalogBuildersOfType(catalog, type)
    .filter(([, builder]) => {
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

const NULL_EXPR: Expr = { doc: 'null', shape: 'literal', depth: 1 }
/**
 * A value in a password field that holds literal text: anything but `null`, `''` or text made
 * only of reference and `{{ENV}}` tokens. It prints as `stored()`, never as the secret.
 */
function isLiteralSecret(value: Value): boolean {
  if (value === null || value === '') return false
  if (typeof value !== 'string') return true
  let rest = value
  for (const token of findWorkflowReferenceTokens(value).reverse()) {
    rest = rest.slice(0, token.start) + rest.slice(token.end)
  }
  return rest.trim() !== ''
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

/** One param of a tool entry as JSON, under the same contract as {@link toolJson}. */
function toolParamJson(tool: CanonicalTool, param: Value): Json {
  const value: unknown = param
  if (!isJson(value)) throw new Error(`Tool entry of type "${tool.type}" is not plain JSON`)
  return value
}

class WorkflowPrinter {
  private readonly workflow: CanonicalWorkflow
  private readonly catalog: BlockCatalog
  private readonly hints: SourceHints
  private readonly options: PrintInput['options']
  private readonly diagnostics: Diag[] = []
  private readonly imports = new Set<string>(['workflow'])
  private usesVars = false
  private readonly blocks: Map<BlockKey, CanonicalBlock>
  private readonly parentOf = new Map<BlockKey, BlockKey | null>()
  /** Each scope's members in declaration order. */
  private readonly scopeMembers = new Map<BlockKey | null, BlockKey[]>()
  private readonly position = new Map<BlockKey, number>()
  private readonly preorder: BlockKey[] = []
  private readonly preorderIndex = new Map<BlockKey, number>()
  /** Edges by source block, in workflow order. */
  private readonly edgesFrom = new Map<BlockKey, CanonicalEdge[]>()
  private idents = new Map<BlockKey, string>()
  private readonly paramNames = new Map<BlockKey, string>()
  private readonly refs: RefPrinter
  private readonly values: ValuePrinter
  private readonly comments: CommentPlacer
  private readonly codeFiles: Array<{ path: string; text: string }> = []
  private readonly codeFileHints = new Map<BlockKey, string>()
  private readonly takenCodePaths = new Set<string>()
  private readonly refTypes: RefTypeScope

  constructor(input: PrintInput) {
    this.workflow = input.workflow
    this.catalog = input.catalog
    this.hints = input.hints ?? { blocks: {} }
    this.options = input.options
    this.blocks = new Map(Object.entries(this.workflow.blocks))
    for (const [key, block] of this.blocks) {
      const parent = block.parent === null ? undefined : this.blocks.get(block.parent)
      this.parentOf.set(key, parent?.subflow && block.parent !== null ? block.parent : null)
    }
    this.breakParentCycles()
    for (const edge of this.workflow.edges) {
      const list = this.edgesFrom.get(edge.from) ?? []
      list.push(edge)
      this.edgesFrom.set(edge.from, list)
    }
    const scope: RefScope = {
      hasBlock: (key) => this.blocks.has(key),
      hasVariable: (key) => Object.hasOwn(this.workflow.variables, key),
      visibility: (from, target) => this.visibility(from, target),
      identOf: (key) => this.idents.get(key) ?? key,
      subflowScope: (from, kind) => this.subflowScope(from, kind),
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
      }
    )
    this.comments = new CommentPlacer(this.workflow.annotations.comments)
    this.refTypes = {
      catalog: this.catalog,
      block: (key) => this.blocks.get(key),
      variable: (key) => getOwn(this.workflow.variables, key),
    }
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

  private subflowScope(from: BlockKey, kind: 'loop' | 'parallel'): string | null {
    for (const ancestor of this.ancestors(from)) {
      if (this.blocks.get(ancestor)?.subflow?.kind === kind) {
        return this.paramNames.get(ancestor) ?? null
      }
    }
    return null
  }

  private isTrigger(block: CanonicalBlock): boolean {
    return block.triggerMode || catalogBlock(this.catalog, block.type)?.category === 'triggers'
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
      this.scopeMembers.set(scope, order)
      order.forEach((key, index) => {
        this.position.set(key, index)
        this.preorderIndex.set(key, this.preorder.length)
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
        hint: getOwn(this.hints.blocks, key)?.ident,
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
      else walk(param.tools)
    }
    for (const row of block.branches?.rows ?? []) walk(row.value)
    if (block.subflow) walk(block.subflow)
    return heads
  }

  private tagFor(
    block: CanonicalBlock,
    catalogBlock: CatalogBlock | undefined,
    sb?: CatalogSubBlock
  ): Tag {
    if (sb?.valueKind === 'code') {
      if (sb.language === 'json') return 'json'
      const language = toLanguage(stringParam(block, 'language')) ?? toLanguage(sb.language)
      return language ? CODE_FILE_EXTENSIONS[language] : 'js'
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
    sb: CatalogSubBlock | undefined,
    single = false
  ): PrintedValue | null {
    const param = getOwn(block.params, id)
    if (!param) return null
    if (param.kind === 'tools') return this.printTools(block, param.tools)
    if (sb?.password && isLiteralSecret(param.value)) return this.values.call('stored', [])
    if (
      single &&
      sb?.type === 'code' &&
      sb.valueKind === 'json' &&
      typeof param.value === 'string'
    ) {
      const literal = this.printJsonField(block, param.value)
      if (literal) return literal
    }
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

  /**
   * JSON field text as the object or array literal compile turns back into exactly that text
   * (`json-fields.ts`), or `null` to keep the text form. A quoted token prints as a bare reference
   * when its value is a string and as `` t`${ref}` `` otherwise; a bare token prints bare, which
   * only a non-string value can be.
   */
  private printJsonField(block: CanonicalBlock, text: string): Expr | null {
    const tree = parseJsonField(text)
    if (tree === undefined) return null
    const isString = (token: string) => refValueKind(token, this.refTypes) === 'string'
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
      if (typeof node === 'string') return this.values.value(node, { tag: 't', from })
      if (node instanceof JsonRef) {
        const expr = this.refs.resolveToken(node.token, from)
        if (expr === null) return node.quoted ? this.values.string(node.token) : null
        if (!node.quoted || isString(node.token)) return refExpr(expr)
        this.imports.add('t')
        return { doc: ['t`${', expr, '}`'], shape: 'template', depth: 2 + pathDepth(expr) }
      }
      if (node === null || typeof node !== 'object') return this.values.json(node)
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
    const check = checkCodeFileBijection(code, language)
    if (!check.ok) return inline('its tokens cannot be rewritten for a code file')
    const text = check.file
    const extension = CODE_FILE_EXTENSIONS[language]
    const hinted = getOwn(this.hints.blocks, block.key)?.codeFile
    let path =
      hinted?.endsWith(`.${extension}`) && !this.takenCodePaths.has(hinted)
        ? hinted
        : `${SOURCE_CODE_DIR}/${kebab(this.idents.get(block.key) ?? block.key)}.${extension}`
    let suffix = 2
    const base = path.slice(0, -(extension.length + 1))
    while (this.takenCodePaths.has(path)) {
      path = `${base}-${suffix}.${extension}`
      suffix += 1
    }
    this.takenCodePaths.add(path)
    this.codeFileHints.set(block.key, path)
    this.codeFiles.push({ path, text })
    return this.values.call('codeFile', [this.values.string(`./${path}`)])
  }

  /**
   * `customTool('key', options?)` for a custom tool stored as the picker's reference (a key, no
   * params, no snapshot); `null` for any other tool, which prints through its builder or `raw()`.
   */
  private customToolCall(block: CanonicalBlock, tool: CanonicalTool): Expr | null {
    const ref = tool.customTool?.ref
    const { type, params, modes, customTool, usageControl, usageControlExpression, ...rest } = tool
    if (
      type !== CUSTOM_TOOL_TYPE ||
      ref?.$sim !== 'resource' ||
      ref.kind !== 'custom-tool' ||
      customTool?.snapshot !== undefined ||
      Object.keys(params).length > 0 ||
      Object.keys(modes).length > 0 ||
      Object.values(rest).some((value) => value !== undefined)
    ) {
      return null
    }
    const options = this.usageOptions(block, { usageControl, usageControlExpression })
    const args: Expr[] = [this.values.string(ref.key)]
    if (options.length > 0) args.push(objectExpr(options))
    return this.values.call('customTool', args)
  }

  /** `usageControl` and `usageControlExpression` options, as a tool form writes them. */
  private usageOptions(
    block: CanonicalBlock,
    tool: Pick<CanonicalTool, 'usageControl' | 'usageControlExpression'>
  ): Property[] {
    const options: Property[] = []
    if (tool.usageControl !== undefined) {
      options.push({ key: 'usageControl', value: this.values.string(tool.usageControl) })
    }
    if (tool.usageControlExpression !== undefined) {
      options.push({
        key: 'usageControlExpression',
        value: this.values.value(tool.usageControlExpression, { tag: 'js', from: block.key }),
      })
    }
    return options
  }

  /** `mcp('server').tool('name', options?)` (agent-tools.ts). */
  private mcpToolCall(block: CanonicalBlock, form: McpToolForm): Expr {
    const options: Property[] = []
    const args = Object.entries(form.args)
    if (args.length > 0) {
      const nested: FieldContext = { tag: 't', from: block.key }
      options.push({
        key: 'args',
        value: objectExpr(
          args.map(([name, value]) => ({
            key: printKey(name),
            value: this.values.value(value, nested),
          }))
        ),
      })
    }
    options.push(...this.usageOptions(block, form))
    if (Object.keys(form.snapshot).length > 0) {
      options.push({ key: 'snapshot', value: this.values.json(form.snapshot as Json) })
    }
    const methodArgs: Expr[] = [this.values.string(form.name)]
    if (options.length > 0) methodArgs.push(objectExpr(options))
    return this.values.methodCall('mcp', [this.values.string(form.server.key)], 'tool', methodArgs)
  }

  /** `childWorkflow('key').asTool(options?)` (agent-tools.ts). */
  private workflowToolCall(block: CanonicalBlock, form: WorkflowToolForm): Expr {
    const options = this.usageOptions(block, form)
    return this.values.methodCall(
      'childWorkflow',
      [this.values.string(form.workflow.key)],
      'asTool',
      options.length > 0 ? [objectExpr(options)] : []
    )
  }

  private printTools(block: CanonicalBlock, tools: CanonicalTool[]): PrintedValue {
    const elements = tools.map((tool) => {
      const mcp = readMcpTool(this.catalog, tool)
      if (mcp) return this.mcpToolCall(block, mcp)
      const childWorkflow = readWorkflowTool(this.catalog, tool)
      if (childWorkflow) return this.workflowToolCall(block, childWorkflow)
      const custom = this.customToolCall(block, tool)
      if (custom) return custom
      const toolBlock = catalogBlock(this.catalog, tool.type)
      const found = findBuilder(this.catalog, tool.type, false, (id) => {
        if (id === 'operation') return tool.operation
        const value = getOwn(tool.params, id)
        return typeof value === 'string' ? value : undefined
      })
      const aliases = toolBlock ? paramAliases(toolBlock, false) : new Map<string, string>()
      const aliasNames = new Set(aliases.values())
      // A stored key spelled like an alias would compile back to the param the alias names.
      if (!found || Object.keys(tool.params).some((id) => aliasNames.has(id))) {
        return this.rawToolCall(tool, toolBlock, aliases)
      }
      const pinned = pinnedIds(found.builder)
      const nested: FieldContext = { tag: 't', from: block.key }
      const params: Property[] = Object.entries(tool.params)
        .filter(([id]) => !pinned.has(id))
        .map(([id, value]) => {
          const sb = toolBlock?.subBlocks.find((candidate) => candidate.id === id)
          return {
            key: printKey(aliases.get(id) ?? id),
            value:
              sb?.password && isLiteralSecret(value)
                ? this.values.call('stored', [])
                : sb
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
      options.push(...this.usageOptions(block, tool))
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

  /**
   * `raw(tool)`: the tool verbatim, except that a password param holding literal text prints as
   * `stored()`, as it does through a builder. A param spelled like an alias is a password when the
   * param the alias names is one.
   */
  private rawToolCall(
    tool: CanonicalTool,
    catalogBlock: CatalogBlock | undefined,
    aliases: ReadonlyMap<string, string>
  ): Expr {
    const passwordIds = new Set<string>()
    for (const subBlock of catalogBlock?.subBlocks ?? []) {
      if (!subBlock.password) continue
      passwordIds.add(subBlock.id)
      const alias = aliases.get(subBlock.id)
      if (alias !== undefined) passwordIds.add(alias)
    }
    const secret = (id: string, value: Value) => passwordIds.has(id) && isLiteralSecret(value)
    const json = toolJson(tool)
    if (!isPlainRecord(json) || !Object.entries(tool.params).some(([id, v]) => secret(id, v))) {
      return this.values.call('raw', [this.values.json(json)])
    }
    const params = objectExpr(
      Object.entries(tool.params).map(([id, value]) => ({
        key: printKey(id),
        value: secret(id, value)
          ? this.values.call('stored', [])
          : this.values.json(toolParamJson(tool, value)),
      }))
    )
    return this.values.call('raw', [
      objectExpr(
        Object.entries(json).map(([key, value]) => ({
          key: printKey(key),
          value: key === 'params' ? params : this.values.json(value),
        }))
      ),
    ])
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
   * Params in catalog registry order, one per canonical pair, under the
   * defaults rule: a value equal to the editor default (`editorDefaults`) is omitted, and an
   * active field with no stored value prints `null` when a default exists. What never executes
   * (`executableInactiveParams`: inactive values, the pair member the mode hides, undeclared ids
   * that do not run) is left out; apply restores it from the stored workflow. A stored id the
   * catalog does not declare that still runs (a schema-agnostic custom block's input, the agent's
   * legacy prompt fields) goes to `extra`, the only place source takes such an id.
   */
  private collectParams(
    block: CanonicalBlock,
    catalogBlock: CatalogBlock | undefined,
    pinned: Set<string>
  ): { params: ParamEntry[]; extra: ParamEntry[] } {
    const params: ParamEntry[] = []
    const extra: ParamEntry[] = []
    const handled = new Set<string>(pinned)
    const branchId = catalogBlock?.graph.branches?.subBlockId
    if (branchId) handled.add(branchId)
    const inactiveIds = new Set(executableInactiveParams(block, this.catalog))
    const defaults: ReadonlyMap<string, EditorDefault> = catalogBlock
      ? editorDefaults(catalogBlock)
      : new Map()
    const push = (list: ParamEntry[], key: string, value: Expr) => {
      list.push({ key: printKey(key), anchor: anchors.param(block.key, key), value })
    }
    const isDefault = (id: string) => {
      const param = getOwn(block.params, id)
      return param?.kind === 'value' && defaults.has(id) && defaults.get(id) === param.value
    }

    if (catalogBlock) {
      const index = buildFieldIndex(catalogBlock, block.triggerMode, pinned)
      for (const id of index.subBlocks.keys()) handled.add(id)
      for (const field of index.fields.values()) {
        if (field.kind === 'pair') {
          const mode: ParamMode = getOwn(block.modes, field.param) ?? 'basic'
          const effective = memberFor(field, mode)
          if (!effective) continue
          if (hasValue(block, effective.id)) {
            if (inactiveIds.has(effective.id)) continue
            if (mode === 'basic' && effective === field.basic && isDefault(effective.id)) continue
            const printed = this.printParamValue(block, catalogBlock, effective.id, effective)
            if (printed) push(params, field.name, printed)
          } else if (
            field.members.some((member) => defaults.has(member.id)) &&
            this.activeIfSet(block, catalogBlock, effective, defaults.get(effective.id) ?? '')
          ) {
            push(params, field.name, NULL_EXPR)
          }
          continue
        }
        const sb = field.sub
        if (!hasValue(block, sb.id)) {
          if (this.needsTodo(block, sb)) {
            push(params, field.name, this.values.call('todo', []))
          } else {
            const fallback = defaults.get(sb.id)
            if (fallback !== undefined && this.activeIfSet(block, catalogBlock, sb, fallback)) {
              push(params, field.name, NULL_EXPR)
            }
          }
          continue
        }
        if (inactiveIds.has(sb.id) || isDefault(sb.id)) continue
        const printed = this.printParamValue(block, catalogBlock, sb.id, sb, true)
        if (printed) push(params, field.name, printed)
      }
    }

    const rest = Object.keys(block.params)
      .filter((id) => !handled.has(id) && !inactiveIds.has(id))
      .sort(compareStrings)
    for (const id of rest) {
      const printed = this.printParamValue(block, catalogBlock, id, undefined)
      if (printed) push(catalogBlock ? extra : params, id, printed)
    }
    return { params, extra }
  }

  /**
   * The params of a response block printed in the `response(name, { body, status?, headers? })`
   * form (`forms/response.ts`): a numeric status as a number, header rows as a record.
   */
  private responseFormParams(block: CanonicalBlock, form: ResponseForm): ParamEntry[] {
    const text = (value: string): Expr => this.values.value(value, { tag: 't', from: block.key })
    const entry = (key: string, expr: Expr): ParamEntry => ({
      key,
      anchor: anchors.param(block.key, key),
      value: expr,
    })
    const entries = [entry('body', this.printJsonField(block, form.data) ?? text(form.data))]
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

  /** A required, always-visible field with no stored value prints `todo()`. */
  private needsTodo(block: CanonicalBlock, sb: CatalogSubBlock): boolean {
    if (sb.required !== true || sb.condition !== undefined || sb.hidden || sb.readOnly) return false
    if (sb.valueKind === 'none' || sb.valueKind === 'branches' || sb.valueKind === 'tools')
      return false
    if (block.triggerMode) return sb.mode === 'trigger'
    if (sb.mode === 'trigger')
      return catalogBlock(this.catalog, block.type)?.category === 'triggers'
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
    return (this.edgesFrom.get(key) ?? []).some((edge) => edge.port.kind === 'error')
  }

  private metaProperties(
    block: CanonicalBlock,
    fields: {
      triggerMode?: boolean | undefined
      extra: Property[]
      subflowData?: Record<string, Json>
      branches?: Property[]
    }
  ): Property[] {
    const meta: Property[] = []
    const yes: Expr = { doc: 'true', shape: 'literal', depth: 1 }
    if (needsKeyOverride(block)) meta.push({ key: 'key', value: this.values.string(block.key) })
    if (!block.enabled) meta.push({ key: 'disabled', value: yes })
    if (block.locked) meta.push({ key: 'locked', value: yes })
    if (block.advancedMode) meta.push({ key: 'advancedMode', value: yes })
    if (fields.triggerMode !== undefined) {
      meta.push({
        key: 'triggerMode',
        value: { doc: String(fields.triggerMode), shape: 'literal', depth: 1 },
      })
    }
    if (block.errorPort && !this.hasErrorEdge(block.key))
      meta.push({ key: 'errorPort', value: yes })
    if (block.retry) meta.push({ key: 'retry', value: this.values.json({ ...block.retry }) })
    if (fields.branches && fields.branches.length > 0) {
      meta.push({ key: 'branches', value: objectExpr(fields.branches) })
    }
    if (fields.extra.length > 0) meta.push({ key: 'extra', value: objectExpr(fields.extra) })
    if (fields.subflowData) {
      meta.push({ key: 'subflowData', value: this.values.json(fields.subflowData) })
    }
    return meta
  }

  /**
   * Branch rows as named keys, plus the meta's per-row title overrides, `title: null` for a row
   * stored with no title, and extra keys.
   */
  private branchEntries(block: CanonicalBlock): { entries: Property[]; meta: Property[] } {
    const branches = block.branches
    if (!branches?.rows) return { entries: [], meta: [] }
    const entries: Property[] = []
    const meta: Property[] = []
    const rows = branches.rows
    rows.forEach((row, index) => {
      const value: Expr = printsAsElseTrue(branches.kind, row, index, rows.length)
        ? { doc: 'true', shape: 'literal', depth: 1 }
        : this.values.value(row.value, {
            tag: branches.kind === 'condition' ? 'js' : 't',
            from: block.key,
          })
      entries.push({ key: printMember(row.key).slice(1), value })
      const rowMeta: Property[] = []
      if (row.titleOverride !== undefined) {
        rowMeta.push({ key: 'title', value: this.values.string(row.titleOverride) })
      } else if (row.titleMissing) {
        rowMeta.push({ key: 'title', value: NULL_EXPR })
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
    const blockSpec = catalogBlock(this.catalog, block.type)
    const found = findBuilder(this.catalog, block.type, block.triggerMode, (id) =>
      stringParam(block, id)
    )
    const pinned = pinnedIds(found?.builder)
    const collected = this.collectParams(block, blockSpec, pinned)
    const { extra } = collected
    const form =
      found?.builder.type === RESPONSE_BLOCK_TYPE
        ? readResponseForm(
            block,
            collected.params.map((entry) => entry.key),
            extra.length > 0
          )
        : null
    const params = form ? this.responseFormParams(block, form) : collected.params
    const paramProps = this.paramProperties(params)
    const extraProps = this.paramProperties(extra)
    const branchSpec = blockSpec?.graph.branches
    const { entries: branchProps, meta: branchMeta } = this.branchEntries(block)

    let generic = found === null
    let topLevel: Property[] = paramProps
    if (block.branches && branchSpec) {
      const collides = paramProps.some((prop) =>
        branchProps.some((branch) => branch.key === prop.key)
      )
      const atTopLevel = branchesAtTopLevel(branchSpec.kind, !generic)
      if (atTopLevel && !collides) {
        topLevel = [...branchProps, ...paramProps]
      } else {
        if (atTopLevel) generic = true
        topLevel = [
          ...paramProps,
          { key: printKey(branchSpec.subBlockId), value: objectExpr(branchProps) },
        ]
      }
    }
    let triggerMode: boolean | undefined
    if (generic) triggerMode = block.triggerMode ? true : undefined
    else if ((found?.builder.triggerMode === true) !== block.triggerMode)
      triggerMode = block.triggerMode
    const meta = this.metaProperties(block, {
      triggerMode,
      extra: extraProps,
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
                    value: this.values.value(value.value, this.context(block, blockSpec)),
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

  /**
   * `loop.<type>(name, config, body, meta?)` / `parallel[.<type>](...)`. Config holds the fields
   * the type runs with; the other types' fields are left to the stored workflow. `meta.extra`
   * carries the container's stored params, and `meta.subflowData` the subflow keys of `block.data`
   * canonicalize could not read as config, which the serializer passes on with the container's
   * data.
   */
  private containerCall(block: CanonicalBlock): Expr {
    const spec = block.subflow
    if (!spec) throw new Error('containerCall requires a subflow block')
    const config: Property[] = []
    const field = (key: string, value: Json | undefined, active: boolean, tag: Tag) => {
      if (value === undefined || !active) return
      config.push({ key, value: this.values.value(value, { tag, from: block.key }) })
    }
    let callee: string
    if (spec.kind === 'loop') {
      callee = `loop.${spec.loopType}`
      const countRuns =
        spec.loopType === 'for' || (spec.loopType === 'doWhile' && !spec.doWhileCondition)
      field('count', spec.iterations, countRuns, 't')
      field('collection', spec.forEachItems, spec.loopType === 'forEach', 't')
      field('condition', spec.whileCondition, spec.loopType === 'while', 'js')
      field('condition', spec.doWhileCondition, spec.loopType === 'doWhile', 'js')
    } else {
      const type = spec.parallelType
      callee = type === undefined ? 'parallel' : `parallel.${type}`
      field('count', spec.count, type !== 'collection', 't')
      field('collection', spec.distribution, type !== 'count', 't')
      field('batchSize', spec.batchSize, true, 't')
    }
    const { params, extra } = this.collectParams(
      block,
      catalogBlock(this.catalog, block.type),
      new Set()
    )
    const subflowData: Record<string, Json> = {}
    for (const [key, value] of Object.entries(block.extra ?? {})) {
      if (SUBFLOW_DATA_KEYS.has(key)) setOwn(subflowData, key, value)
    }
    const meta = this.metaProperties(block, {
      extra: this.paramProperties([...params, ...extra]),
      ...(Object.keys(subflowData).length > 0 && { subflowData }),
    })
    const body = this.scopeStatements(block.key)
    const args: Expr[] = [
      this.values.string(block.name),
      objectExpr(config),
      arrowExpr(this.paramNames.get(block.key) ?? 'p', body),
    ]
    if (meta.length > 0) args.push(objectExpr(meta))
    return this.values.call(callee, args)
  }

  /** Whether scope `outer` encloses scope `inner` (or is it): its names are visible there. */
  private encloses(outer: BlockKey | null, inner: BlockKey | null): boolean {
    for (let scope = inner; ; scope = this.parentOf.get(scope) ?? null) {
      if (scope === outer) return true
      if (scope === null) return false
    }
  }

  /**
   * The scope an edge's wiring statement prints in: the source's, unless the target sits in a
   * scope nested inside it (a container's child), where the target's name is visible and the
   * source's still is.
   */
  private edgeScope(edge: CanonicalEdge): BlockKey | null {
    const from = this.parentOf.get(edge.from) ?? null
    const to = this.parentOf.get(edge.to) ?? null
    return this.encloses(from, to) ? to : from
  }

  /** The blocks whose edges may print in `scope`: its own, then those of every enclosing scope. */
  private wiringSources(scope: BlockKey | null): BlockKey[] {
    const sources = [...(this.scopeMembers.get(scope) ?? [])]
    for (let outer = scope; outer !== null; ) {
      outer = this.parentOf.get(outer) ?? null
      sources.push(...(this.scopeMembers.get(outer) ?? []))
    }
    return sources
  }

  private identExpr(key: BlockKey): Expr {
    return { doc: this.idents.get(key) ?? key, shape: 'identifier', depth: 1 }
  }

  private wiring(
    scope: BlockKey | null
  ): Array<{ expr: Expr; anchor: AnchorKey; source: BlockKey }> {
    const statements: Array<{ expr: Expr; anchor: AnchorKey; source: BlockKey }> = []
    const byTarget = (a: CanonicalEdge, b: CanonicalEdge) =>
      (this.position.get(a.to) ?? 0) - (this.position.get(b.to) ?? 0) ||
      (this.preorderIndex.get(a.to) ?? -1) - (this.preorderIndex.get(b.to) ?? -1)
    const call = (head: string, targets: CanonicalEdge[], method: string): Expr =>
      callExpr(
        `${head}.${method}`,
        [...targets].sort(byTarget).map((edge) => this.identExpr(edge.to))
      )
    const raw = (source: BlockKey, handle: string, target: BlockKey): Expr => {
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
      ])
    }

    if (scope !== null) {
      const container = this.blocks.get(scope)
      const starts = (this.edgesFrom.get(scope) ?? []).filter((e) => e.port.kind === 'subflowStart')
      if (container?.subflow && starts.length > 0) {
        statements.push({
          expr: call(this.paramNames.get(scope) ?? 'p', starts, 'to'),
          anchor: anchors.edges(scope, 'subflowStart'),
          source: scope,
        })
      }
    }

    for (const source of this.wiringSources(scope)) {
      const block = this.blocks.get(source)
      if (!block) continue
      const ident = this.idents.get(source) ?? source
      const edges = (this.edgesFrom.get(source) ?? []).filter(
        (edge) => this.blocks.has(edge.to) && this.edgeScope(edge) === scope
      )
      const isContainer = block.subflow !== undefined
      const hasBranches =
        block.branches !== undefined ||
        catalogBlock(this.catalog, block.type)?.graph.branches !== undefined
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
            statements.push({ expr: raw(source, 'loop-start-source', edge.to), anchor, source })
          }
          continue
        }
        if (kind.kind === 'raw' || (kind.kind === 'out' && (isContainer || hasBranches))) {
          const handle = kind.kind === 'raw' ? kind.handle : 'source'
          for (const edge of [...targets].sort(byTarget)) {
            statements.push({ expr: raw(source, handle, edge.to), anchor, source })
          }
          continue
        }
        if (kind.kind === 'subflowEnd' && !isContainer) {
          for (const edge of [...targets].sort(byTarget)) {
            statements.push({ expr: raw(source, 'loop-end-source', edge.to), anchor, source })
          }
          continue
        }
        if (kind.kind === 'error') {
          statements.push({ expr: call(ident, targets, 'onError'), anchor, source })
        } else if (kind.kind === 'branch') {
          statements.push({
            expr: call(`${ident}${printMember(kind.key)}`, targets, 'to'),
            anchor,
            source,
          })
        } else {
          statements.push({ expr: call(ident, targets, 'to'), anchor, source })
        }
      }
    }
    return statements
  }

  /** Declarations then wiring for one scope (the workflow body or a container callback). */
  private scopeStatements(scope: BlockKey | null): StatementList {
    const members = this.scopeMembers.get(scope) ?? []
    const calls = members.map((key) => {
      const block = this.blocks.get(key)
      return block ? { key, call: this.blockCall(block) } : null
    })
    const wiring = this.wiring(scope)
    const wiringDocs: Doc[] = []
    // An expression statement over the call; a declaration adds its declarator too.
    let depth = 0
    const seenAnchors = new Set<AnchorKey>()
    wiring.forEach((statement, index) => {
      const attached: AttachedComments = seenAnchors.has(statement.anchor)
        ? { leading: [], trailing: [] }
        : this.comments.take(statement.anchor)
      seenAnchors.add(statement.anchor)
      if (index === 0 && scope === null) {
        const wiringComments = this.comments.take(anchors.wiring)
        attached.leading.unshift(...wiringComments.leading)
        attached.trailing.push(...wiringComments.trailing)
      }
      wiringDocs.push(withComments(statement.expr.doc, attached))
      depth = Math.max(depth, 1 + statement.expr.depth)
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
      depth = Math.max(depth, 2 + call.depth)
    }
    if (scope === null && wiring.length === 0) {
      const dangling = this.comments.take(anchors.wiring)
      for (const comment of [...dangling.leading, ...dangling.trailing]) wiringDocs.push(comment)
    }
    const docs =
      declarations.length > 0 && wiringDocs.length > 0
        ? [...declarations, '', ...wiringDocs]
        : [...declarations, ...wiringDocs]
    return { docs, depth }
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

    const header = this.comments.take(anchors.header)
    const footer = this.comments.take(anchors.footer)
    this.comments.dropRemaining()

    // compareStrings is the order Biome's organizeImports keeps import specifiers in.
    const importNames = [...this.imports].sort(compareStrings)
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
    const text = printDoc(parts, LINE_WIDTH)

    const hintBlocks: Record<BlockKey, SourceHintBlock> = { ...this.hints.blocks }
    this.preorder.forEach((key, index) => {
      const codeFile = this.codeFileHints.get(key)
      setOwn(hintBlocks, key, {
        ident: this.idents.get(key) ?? key,
        order: index,
        ...(codeFile ? { codeFile } : {}),
      })
    })
    return {
      files: [{ path: SOURCE_ENTRY_FILE, text }, ...this.codeFiles],
      hints: { blocks: hintBlocks },
      diagnostics: [...this.refs.diagnostics, ...this.diagnostics, ...this.comments.diagnostics],
      // File, Program, then the default export over the workflow call; the import line is
      // File, Program, ImportDeclaration, ImportSpecifier, Identifier.
      entryDepth: Math.max(5, 3 + workflowCall.depth),
    }
  }
}

/**
 * A legacy key the display name cannot carry: a `name~n` collision key, or a reserved name
 * (`Loop`, `Parallel`). Printed as `meta.key`, which the compiler accepts only for a key the
 * stored workflow already has (`CompileInput.knownKeys`).
 */
function needsKeyOverride(block: CanonicalBlock): boolean {
  return (
    block.key !== normalizeWorkflowBlockName(block.name) || isReservedWorkflowBlockName(block.key)
  )
}

/**
 * Prints a CWM as a source file. Its output always compiles with zero errors: a block
 * whose type has no catalog builder prints through `block(type, name, params, meta?)`.
 */
export function printWorkflow(input: PrintInput): PrintResult {
  return new WorkflowPrinter(input).print()
}
