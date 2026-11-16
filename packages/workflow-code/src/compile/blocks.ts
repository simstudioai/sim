import type { Node, ObjectExpression, ObjectProperty } from '@babel/types'
import { isRecordLike } from '@sim/utils/object'
import type { BlockRetryConfig } from '@sim/workflow-types/workflow'
import { encodeAnchor } from '../anchors'
import type { CatalogBlock, CatalogSubBlock } from '../catalog/types'
import { type CodeFileLanguage, codeFileLanguage, fromCodeFile } from '../code-files'
import type {
  AnchorKey,
  CanonicalBlock,
  CanonicalBranches,
  CanonicalBranchRow,
  CanonicalParam,
  Json,
  LoopSpec,
  ParallelSpec,
  ParamMode,
  SubBlockId,
  Value,
} from '../model'
import { type BlockDecl, type CompileContext, rangeOf, recordSpan } from './context'
import { didYouMean } from './hints'
import { compileToolList } from './tools'
import {
  buildFieldIndex,
  type CatalogField,
  type FieldIndex,
  isRequired,
  isVisible,
  memberFor,
  valueKindMatches,
} from './validate-catalog'
import {
  type CompiledValue,
  compileJsonLiteral,
  compileValue,
  isSelectorForm,
  literalText,
  objectEntries,
  setOwn,
  type ValueSite,
} from './values'

export interface CompiledBlock {
  block: CanonicalBlock
  /** Param ids written under `meta.inactive`. */
  inactive: SubBlockId[]
  /** Repo-relative path of the function-code file, when the code came from `file()`. */
  codeFile?: string
}

const META_KEYS = [
  'disabled',
  'locked',
  'advancedMode',
  'triggerMode',
  'errorPort',
  'retry',
  'modes',
  'branches',
  'inactive',
  '$unknown',
]
const BRANCH_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const EDGE_METHOD_NAMES = new Set(['to', 'onError'])
const DEFAULT_LOOP_ITERATIONS = 5
const CODE_LANGUAGES: ReadonlySet<string> = new Set(['javascript', 'python', 'shell'])

interface CompiledMeta {
  enabled: boolean
  locked: boolean
  errorPort: boolean
  retry: BlockRetryConfig | null
  advancedMode: boolean
  triggerMode: boolean | null
  modes: Map<string, ParamMode>
  /** Per-row `title` and `extra` (the printer's meta `branches`). */
  branches: Array<[string, ObjectProperty]>
  inactive: Array<[string, ObjectProperty]>
  opaque: Record<string, Json> | null
}

function unsupported(
  ctx: CompileContext,
  node: Node,
  message: string,
  hint: string,
  decl: BlockDecl
): void {
  ctx.reporter.report('E_UNSUPPORTED_SYNTAX', message, rangeOf(ctx, node), {
    hint,
    blockKey: decl.key,
  })
}

function withHint(hint: string | undefined): { hint?: string } {
  return hint === undefined ? {} : { hint }
}

function booleanLiteral(ctx: CompileContext, property: ObjectProperty, decl: BlockDecl): boolean {
  if (property.value.type === 'BooleanLiteral') return property.value.value
  unsupported(
    ctx,
    property.value,
    'Write true or false.',
    'This meta field is a boolean literal.',
    decl
  )
  return false
}

function compileRetry(ctx: CompileContext, node: Node, site: ValueSite): BlockRetryConfig | null {
  const json = compileJsonLiteral(ctx, node, site)
  if (json === undefined) return null
  if (
    isRecordLike(json) &&
    Object.keys(json).sort().join(',') === 'enabled,maxTries,waitBetweenTriesMs' &&
    typeof json.enabled === 'boolean' &&
    typeof json.maxTries === 'number' &&
    typeof json.waitBetweenTriesMs === 'number'
  ) {
    return {
      enabled: json.enabled,
      maxTries: json.maxTries,
      waitBetweenTriesMs: json.waitBetweenTriesMs,
    }
  }
  unsupported(
    ctx,
    node,
    'retry needs enabled, maxTries and waitBetweenTriesMs.',
    'Write retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 1000 }.',
    site.decl
  )
  return null
}

function objectValue(
  ctx: CompileContext,
  property: ObjectProperty,
  decl: BlockDecl,
  example: string
): ObjectExpression | null {
  if (property.value.type === 'ObjectExpression') return property.value
  unsupported(ctx, property.value, 'Write an object literal here.', `Write ${example}.`, decl)
  return null
}

/** Registers a properties object as a comment list with one anchor per property. */
function registerList(
  ctx: CompileContext,
  node: ObjectExpression,
  entries: Array<[string, ObjectProperty]>,
  anchorOf: (key: string) => AnchorKey,
  decl: BlockDecl
): void {
  const owner = encodeAnchor({ kind: 'block', block: decl.key })
  const addItem = ctx.comments.list(node.start ?? 0, node.end ?? 0, { owner, tail: 'last-item' })
  for (const [key, property] of entries) addItem(property, anchorOf(key))
}

/** `meta`: block-level fields, in the printer's vocabulary (s2 D2, build-spec decision 2). */
function compileMeta(ctx: CompileContext, node: Node | undefined, site: ValueSite): CompiledMeta {
  const meta: CompiledMeta = {
    enabled: true,
    locked: false,
    errorPort: false,
    retry: null,
    advancedMode: false,
    triggerMode: null,
    modes: new Map(),
    branches: [],
    inactive: [],
    opaque: null,
  }
  if (!node) return meta
  const { decl } = site
  if (node.type !== 'ObjectExpression') {
    unsupported(ctx, node, 'Block meta is an object literal.', 'Write { disabled: true }.', decl)
    return meta
  }
  for (const [key, property] of objectEntries(ctx, node)) {
    switch (key) {
      case 'disabled':
        meta.enabled = !booleanLiteral(ctx, property, decl)
        break
      case 'locked':
        meta.locked = booleanLiteral(ctx, property, decl)
        break
      case 'errorPort':
        meta.errorPort = booleanLiteral(ctx, property, decl)
        break
      case 'advancedMode':
        meta.advancedMode = booleanLiteral(ctx, property, decl)
        break
      case 'triggerMode':
        meta.triggerMode = booleanLiteral(ctx, property, decl)
        break
      case 'retry':
        meta.retry = compileRetry(ctx, property.value, site)
        break
      case 'modes': {
        const modes = objectValue(ctx, property, decl, "modes: { channel: 'basic' }")
        if (!modes) break
        for (const [param, modeProperty] of objectEntries(ctx, modes)) {
          const mode = literalText(modeProperty.value)
          if (mode !== 'basic' && mode !== 'advanced') {
            unsupported(
              ctx,
              modeProperty.value,
              "A mode is 'basic' or 'advanced'.",
              "Write 'basic' or 'advanced'.",
              decl
            )
            continue
          }
          meta.modes.set(param, mode)
        }
        break
      }
      case 'branches': {
        const branches = objectValue(ctx, property, decl, "branches: { key: { title: '...' } }")
        if (branches) meta.branches = objectEntries(ctx, branches)
        break
      }
      case 'inactive': {
        const inactive = objectValue(ctx, property, decl, 'inactive: { field: value }')
        if (!inactive) break
        meta.inactive = objectEntries(ctx, inactive)
        registerList(
          ctx,
          inactive,
          meta.inactive,
          (param) => encodeAnchor({ kind: 'inactive', block: decl.key, param }),
          decl
        )
        break
      }
      case '$unknown': {
        const json = compileJsonLiteral(ctx, property.value, site)
        if (json === undefined) break
        if (!isRecordLike(json)) {
          unsupported(
            ctx,
            property.value,
            '$unknown is an object.',
            'Write $unknown: { key: value }.',
            decl
          )
          break
        }
        meta.opaque = json as Record<string, Json>
        break
      }
      default:
        unsupported(
          ctx,
          property,
          `${key} is not a block meta field.`,
          `Meta fields are ${META_KEYS.join(', ')}.`,
          decl
        )
    }
  }
  return meta
}

function resolveRelative(base: string, relative: string): string | null {
  if (!relative.startsWith('./') && !relative.startsWith('../')) return null
  if (relative.includes('\\') || relative.includes('\0')) return null
  const parts = base.split('/').slice(0, -1)
  for (const [index, segment] of relative.split('/').entries()) {
    if (segment === '.' && index === 0) continue
    if (segment === '' || segment === '.') return null
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}

/** Reads a `file('./x.js')` code file back into stored code (build-spec decision 9). */
function readCodeFile(
  ctx: CompileContext,
  compiled: Extract<CompiledValue, { kind: 'file' }>,
  language: string,
  decl: BlockDecl
): { code: string; path: string } | null {
  const at = rangeOf(ctx, compiled.pathNode)
  if (!CODE_LANGUAGES.has(language)) {
    ctx.reporter.report(
      'E_CODE_FILE_PATH',
      `Code files hold javascript, python or shell, not ${language}.`,
      at,
      { hint: 'Write the code inline with js``, or set language.', blockKey: decl.key }
    )
    return null
  }
  const path = resolveRelative(ctx.file, compiled.path)
  if (path === null || codeFileLanguage(compiled.path) !== language) {
    ctx.reporter.report(
      'E_CODE_FILE_PATH',
      path === null
        ? `${compiled.path} is not a relative path inside the repository.`
        : `${compiled.path} does not match the block language ${language}.`,
      at,
      {
        hint: "Write file('./functions/name.js') with .js, .py or .sh matching language.",
        blockKey: decl.key,
      }
    )
    return null
  }
  const text = ctx.files.get(path)
  if (text === undefined) {
    ctx.reporter.report('E_CODE_FILE_MISSING', `${path} was not provided.`, at, {
      hint: 'Create the file, or fix the path.',
      blockKey: decl.key,
    })
    return null
  }
  if (text.length > ctx.limits.maxBytes) {
    ctx.reporter.report(
      'E_LIMIT_EXCEEDED',
      `${path} is larger than ${ctx.limits.maxBytes} bytes.`,
      at,
      { blockKey: decl.key }
    )
    return null
  }
  ctx.reporter.addFile(path, text)
  const back = fromCodeFile(text, language as CodeFileLanguage)
  if (!back.ok) {
    for (const error of back.errors) {
      ctx.reporter.report(
        'E_SYNTAX',
        error.message,
        { file: path, start: error.start, end: error.start + 1 },
        { blockKey: decl.key }
      )
    }
    return null
  }
  return { code: back.code, path }
}

/** input-format sugar: `{ name: 'string' }` or `{ name: { type, ... } }` → stored item list. */
function inputFormatItems(value: Value): Value {
  if (!isRecordLike(value) || '$sim' in value) return value
  return Object.entries(value).map(([name, entry]) => {
    if (typeof entry === 'string') return { name, type: entry, value: '' }
    const item: Record<string, Value> = { name }
    if (isRecordLike(entry) && !('$sim' in entry)) {
      for (const [key, field] of Object.entries(entry)) setOwn(item, key, field)
    } else {
      setOwn(item, 'value', entry)
    }
    return item
  })
}

interface WrittenParam {
  property: ObjectProperty
  param: string
  /** The subBlock the value landed in. */
  target: SubBlockId
  /** Written as a literal, so `W_VALUE_KIND` applies. */
  checked: boolean
  value: Value
}

/** The site for one field: variables-input fields read bare `vars.k` as the variable itself. */
function fieldSite(site: ValueSite, sub: CatalogSubBlock | undefined): ValueSite {
  return sub?.structured === 'variables' ? { ...site, varNodes: true } : site
}

/** Rows from branch entries (build-spec decision 5, A7): `else: true` is the empty else. */
function compileBranchRows(
  ctx: CompileContext,
  entries: Array<[string, ObjectProperty]>,
  kind: 'condition' | 'router',
  block: CatalogBlock | undefined,
  site: ValueSite
): CanonicalBranchRow[] {
  const { decl } = site
  const outputs = new Set(Object.keys(block?.outputs ?? {}))
  const rows: CanonicalBranchRow[] = []
  for (const [index, [key, property]] of entries.entries()) {
    recordSpan(ctx, { kind: 'param', block: decl.key, param: key }, property)
    if (!BRANCH_KEY.test(key)) {
      unsupported(
        ctx,
        property,
        `${key} is not a valid branch key.`,
        'Branch keys are JS identifiers.',
        decl
      )
      continue
    }
    if (outputs.has(key) || EDGE_METHOD_NAMES.has(key)) {
      ctx.reporter.report(
        'E_BRANCH_KEY_COLLIDES',
        `The branch ${key} collides with ${outputs.has(key) ? 'an output' : 'an edge method'} of this block.`,
        rangeOf(ctx, property),
        { hint: 'Rename the branch.', blockKey: decl.key }
      )
      continue
    }
    const isLast = index === entries.length - 1
    if (
      kind === 'condition' &&
      key === 'else' &&
      isLast &&
      property.value.type === 'BooleanLiteral' &&
      property.value.value
    ) {
      rows.push({ key, value: '' })
      continue
    }
    const compiled = compileValue(ctx, property.value, site)
    if (!compiled) continue
    if (compiled.kind === 'value' && typeof compiled.value === 'string') {
      rows.push({ key, value: compiled.value })
      continue
    }
    unsupported(
      ctx,
      property.value,
      'A branch value is text.',
      'Write a string or a js`` template.',
      decl
    )
  }
  const last = entries[entries.length - 1]
  if (kind === 'condition' && entries.length >= 2 && last && last[0] !== 'else') {
    ctx.reporter.report(
      'E_BRANCH_ELSE_LAST',
      'A condition with two or more branches ends with else.',
      rangeOf(ctx, last[1]),
      { hint: 'Add else: true as the last branch.', blockKey: decl.key }
    )
  }
  return rows
}

/** Applies meta `branches: { key: { title?, extra? } }` to the rows. */
function applyBranchMeta(
  ctx: CompileContext,
  rows: CanonicalBranchRow[] | null,
  entries: Array<[string, ObjectProperty]>,
  site: ValueSite
): void {
  for (const [key, property] of entries) {
    const row = rows?.find((candidate) => candidate.key === key)
    if (!row) {
      ctx.reporter.report(
        'E_UNKNOWN_BRANCH',
        `There is no branch ${key} to annotate.`,
        rangeOf(ctx, property),
        { blockKey: site.decl.key }
      )
      continue
    }
    const json = compileJsonLiteral(ctx, property.value, site)
    if (
      !isRecordLike(json) ||
      Object.keys(json).some((field) => field !== 'title' && field !== 'extra') ||
      (json.title !== undefined && typeof json.title !== 'string') ||
      (json.extra !== undefined && !isRecordLike(json.extra))
    ) {
      unsupported(
        ctx,
        property.value,
        'Branch meta is { title?, extra? }.',
        "Write { title: 'Label' } or { extra: { key: value } }.",
        site.decl
      )
      continue
    }
    if (typeof json.title === 'string') row.titleOverride = json.title
    if (isRecordLike(json.extra)) row.extra = json.extra as Record<string, Json>
  }
}

function storedValues(params: Record<SubBlockId, CanonicalParam>): Map<string, Value> {
  const values = new Map<string, Value>()
  for (const [id, param] of Object.entries(params)) {
    if (param.kind === 'value') values.set(id, param.value)
  }
  return values
}

interface BlockState {
  decl: BlockDecl
  site: ValueSite
  meta: CompiledMeta
  params: Record<SubBlockId, CanonicalParam>
  modes: Record<string, ParamMode>
  written: WrittenParam[]
  todos: Map<string, ObjectProperty>
  pendingFile: { compiled: Extract<CompiledValue, { kind: 'file' }>; target: SubBlockId } | null
}

function isJsonContainer(value: Value): boolean {
  return Array.isArray(value) || (isRecordLike(value) && !('$sim' in value))
}

/**
 * Compiles one catalog param into its member subBlock (build-spec decision 7): a selector call
 * (or a non-empty array of them) is basic, anything else advanced, and an explicit `meta.modes`
 * entry wins either way, as the printer writes one exactly when the derived mode would be wrong.
 */
function compileField(
  ctx: CompileContext,
  state: BlockState,
  field: CatalogField,
  property: ObjectProperty
): void {
  const { decl, meta, params, modes } = state
  const firstSub = field.kind === 'single' ? field.sub : field.members[0]
  const site = fieldSite(state.site, firstSub)
  if (firstSub?.valueKind === 'tools') {
    const tools = compileToolList(ctx, property.value, site)
    if (tools) setOwn(params, firstSub.id, { kind: 'tools', tools })
    return
  }
  const compiled = compileValue(ctx, property.value, site)
  if (!compiled || compiled.kind === 'absent') return
  if (compiled.kind === 'todo') {
    state.todos.set(field.param, property)
    return
  }
  if (compiled.kind === 'file') {
    if (field.kind !== 'single' || field.sub.type !== 'code') {
      unsupported(
        ctx,
        property.value,
        'file() holds a function block code.',
        "Write code: file('./functions/x.js').",
        decl
      )
      return
    }
    state.pendingFile = { compiled, target: field.sub.id }
    return
  }

  let target: CatalogSubBlock | undefined
  if (field.kind === 'pair') {
    const mode =
      meta.modes.get(field.param) ?? (isSelectorForm(compiled.form) ? 'basic' : 'advanced')
    setOwn(modes, field.param, mode)
    target = memberFor(field, mode)
  } else {
    target = field.sub
  }
  if (!target) return

  let value = compiled.value
  let checked = compiled.form === 'literal'
  if (target.type === 'code' && compiled.form === 'literal' && isJsonContainer(value)) {
    value = JSON.stringify(value, null, 2)
    checked = false
  } else if (target.structured === 'inputFormat' && compiled.form === 'literal') {
    value = inputFormatItems(value)
  }
  setOwn(params, target.id, { kind: 'value', value })
  state.written.push({ property, param: field.param, target: target.id, checked, value })
}

/** Compiles a block call: `builder(name, params, meta?)` or `block(type, name, params, meta?)`. */
function compileRegularBlock(ctx: CompileContext, decl: BlockDecl): CompiledBlock | null {
  const builder = decl.builder
  if (builder.kind !== 'catalog' && builder.kind !== 'generic') return null
  const site: ValueSite = { decl, scope: decl.scope }
  const [paramsNode, metaNode, ...extra] = decl.call.arguments.slice(
    builder.kind === 'generic' ? 2 : 1
  )
  for (const node of extra) {
    unsupported(ctx, node, 'Too many arguments.', 'Pass (name, params, meta?).', decl)
  }

  const catalogBlock = builder.block
  const meta = compileMeta(ctx, metaNode, site)
  const triggerMode =
    meta.triggerMode ?? (builder.kind === 'catalog' && builder.builder.triggerMode === true)
  const state: BlockState = {
    decl,
    site,
    meta,
    params: {},
    modes: {},
    written: [],
    todos: new Map(),
    pendingFile: null,
  }
  const { params, modes } = state

  const pinned = new Set<string>()
  if (builder.kind === 'catalog') {
    if (builder.builder.operation !== undefined) {
      pinned.add('operation')
      setOwn(params, 'operation', { kind: 'value', value: builder.builder.operation })
    }
    for (const [id, value] of Object.entries(builder.builder.fixed ?? {})) {
      pinned.add(id)
      setOwn(params, id, { kind: 'value', value })
    }
  }
  const index = catalogBlock ? buildFieldIndex(catalogBlock, triggerMode, pinned) : null
  const branchField = catalogBlock?.graph.branches
  const conditionForm = builder.kind === 'catalog' && branchField?.kind === 'condition'

  if (paramsNode && paramsNode.type !== 'ObjectExpression') {
    unsupported(ctx, paramsNode, 'Params are an object literal.', 'Write { field: value }.', decl)
  }
  const paramsObject = paramsNode?.type === 'ObjectExpression' ? paramsNode : undefined
  const branchEntries: Array<[string, ObjectProperty]> = []
  let branches: CanonicalBranches | undefined = branchField
    ? { kind: branchField.kind, rows: null }
    : undefined

  if (paramsObject) {
    const entries = objectEntries(ctx, paramsObject, (property, key) => {
      ctx.reporter.report(
        conditionForm ? 'E_DUPLICATE_BRANCH_KEY' : 'E_UNSUPPORTED_SYNTAX',
        `The key ${key} is written twice.`,
        rangeOf(ctx, property),
        { hint: 'Write each key once.', blockKey: decl.key }
      )
    })
    const addItem = ctx.comments.list(paramsObject.start ?? 0, paramsObject.end ?? 0, {
      owner: encodeAnchor({ kind: 'block', block: decl.key }),
      tail: 'last-item',
    })
    for (const [key, property] of entries) {
      addItem(property, encodeAnchor({ kind: 'param', block: decl.key, param: key }))
      recordSpan(ctx, { kind: 'param', block: decl.key, param: key }, property)
      if (branchField && key === branchField.subBlockId) {
        if (property.value.type !== 'ObjectExpression') {
          unsupported(
            ctx,
            property.value,
            'Branches are an object literal.',
            'Write { if: js`...`, else: true }.',
            decl
          )
          continue
        }
        const rows = objectEntries(ctx, property.value, (duplicate, name) => {
          ctx.reporter.report(
            'E_DUPLICATE_BRANCH_KEY',
            `The branch ${name} is written twice.`,
            rangeOf(ctx, duplicate),
            { hint: 'Give each branch a unique key.', blockKey: decl.key }
          )
        })
        branches = {
          kind: branchField.kind,
          rows:
            property.value.properties.length === 0
              ? null
              : compileBranchRows(ctx, rows, branchField.kind, catalogBlock, site),
        }
        continue
      }
      if (conditionForm && !index?.fields.has(key) && !pinned.has(key)) {
        branchEntries.push([key, property])
        continue
      }
      if (pinned.has(key)) {
        ctx.reporter.report(
          'E_FIXED_PARAM',
          `The builder already sets ${key}.`,
          rangeOf(ctx, property),
          { hint: `Remove ${key}; the method name pins it.`, blockKey: decl.key, param: key }
        )
        continue
      }
      if (!index) {
        const compiled = compileValue(ctx, property.value, site)
        if (!compiled || compiled.kind === 'absent' || compiled.kind === 'todo') continue
        if (compiled.kind === 'file') {
          unsupported(
            ctx,
            property.value,
            'file() needs a catalog block type.',
            'Write the code inline.',
            decl
          )
          continue
        }
        setOwn(params, key, { kind: 'value', value: compiled.value })
        continue
      }
      const field = index.fields.get(key)
      if (!field) {
        const alias = index.memberAliases.get(key)
        ctx.reporter.report(
          'E_UNKNOWN_PARAM',
          `${catalogBlock?.name ?? decl.key} has no param ${key}.`,
          rangeOf(ctx, property),
          {
            ...withHint(
              alias
                ? `Write it as ${alias}; the value kind picks the basic or advanced field.`
                : didYouMean(key, index.fields.keys())
            ),
            blockKey: decl.key,
            param: key,
          }
        )
        continue
      }
      compileField(ctx, state, field, property)
    }
  }
  if (conditionForm && branchField) {
    branches = {
      kind: 'condition',
      rows:
        branchEntries.length === 0
          ? null
          : compileBranchRows(ctx, branchEntries, 'condition', catalogBlock, site),
    }
  }
  if (branches) {
    applyBranchMeta(ctx, branches.rows, meta.branches, site)
  } else if (meta.branches[0]) {
    unsupported(
      ctx,
      meta.branches[0][1],
      'This block has no branches.',
      'Remove branches from the meta.',
      decl
    )
  }

  let codeFile: string | undefined
  if (state.pendingFile) {
    const languageParam = params.language
    const language =
      languageParam?.kind === 'value' && typeof languageParam.value === 'string'
        ? languageParam.value
        : 'javascript'
    const read = readCodeFile(ctx, state.pendingFile.compiled, language, decl)
    if (read) {
      setOwn(params, state.pendingFile.target, { kind: 'value', value: read.code })
      codeFile = read.path
    }
  }

  for (const [param, mode] of meta.modes) {
    if (!Object.hasOwn(modes, param)) setOwn(modes, param, mode)
  }
  for (const field of index?.fields.values() ?? []) {
    if (field.kind === 'pair' && !Object.hasOwn(modes, field.param))
      setOwn(modes, field.param, 'basic')
  }

  const inactive = compileInactive(ctx, meta.inactive, params, site)
  if (index) checkFields(ctx, index, state, inactive.properties)

  const block: CanonicalBlock = {
    key: decl.key,
    name: decl.name,
    type: builder.type,
    parent: decl.parent?.key ?? null,
    enabled: meta.enabled,
    locked: meta.locked,
    triggerMode,
    advancedMode: meta.advancedMode,
    errorPort: meta.errorPort,
    retry: meta.retry,
    params,
    modes,
    ...(branches && { branches }),
    ...(meta.opaque && { opaque: { data: meta.opaque } }),
  }
  return { block, inactive: inactive.ids, ...(codeFile !== undefined && { codeFile }) }
}

function catalogSubBlock(decl: BlockDecl, id: SubBlockId): CatalogSubBlock | undefined {
  const block =
    decl.builder.kind === 'catalog' || decl.builder.kind === 'generic'
      ? decl.builder.block
      : undefined
  return block?.subBlocks.find((candidate) => candidate.id === id)
}

/**
 * `meta.inactive`: stored values kept but not effective (build-spec decision 2): annotated stale
 * values, the non-effective member of a pair, and ids the catalog does not know. Any id is
 * accepted, by subBlock id.
 */
function compileInactive(
  ctx: CompileContext,
  entries: Array<[string, ObjectProperty]>,
  params: Record<SubBlockId, CanonicalParam>,
  site: ValueSite
): { ids: SubBlockId[]; properties: Map<SubBlockId, ObjectProperty> } {
  const ids: SubBlockId[] = []
  const properties = new Map<SubBlockId, ObjectProperty>()
  const { decl } = site
  for (const [id, property] of entries) {
    if (Object.hasOwn(params, id)) {
      unsupported(
        ctx,
        property,
        `${id} is both active and inactive.`,
        'Keep the value in params or in inactive, not both.',
        decl
      )
      continue
    }
    recordSpan(ctx, { kind: 'inactive', block: decl.key, param: id }, property)
    const sub = catalogSubBlock(decl, id)
    if (sub?.valueKind === 'tools') {
      const tools = compileToolList(ctx, property.value, fieldSite(site, sub))
      if (!tools) continue
      setOwn(params, id, { kind: 'tools', tools })
    } else {
      const compiled = compileValue(ctx, property.value, fieldSite(site, sub))
      if (!compiled || compiled.kind !== 'value') continue
      setOwn(params, id, { kind: 'value', value: compiled.value })
    }
    ids.push(id)
    properties.set(id, property)
  }
  return { ids, properties }
}

/** Catalog warnings: visibility, required fields, value kinds (s3 §4 "Catalog checks"). */
function checkFields(
  ctx: CompileContext,
  index: FieldIndex,
  state: BlockState,
  inactive: Map<SubBlockId, ObjectProperty>
): void {
  const { decl, params, modes } = state
  const values = storedValues(params)
  for (const entry of state.written) {
    const sub = index.subBlocks.get(entry.target)
    if (!sub) continue
    if (!isVisible(sub, values)) {
      ctx.reporter.report(
        'W_FIELD_NOT_APPLICABLE',
        `${entry.param} is hidden under the block's current values; it is kept but not used.`,
        rangeOf(ctx, entry.property),
        {
          hint: 'Remove it, or move it under meta.inactive.',
          blockKey: decl.key,
          param: entry.param,
        }
      )
    }
    if (entry.checked && !valueKindMatches(sub.valueKind, entry.value)) {
      ctx.reporter.report(
        'W_VALUE_KIND',
        `${entry.param} expects a ${sub.valueKind} value; the value is kept as written.`,
        rangeOf(ctx, entry.property),
        { blockKey: decl.key, param: entry.param }
      )
    }
  }
  for (const [id, property] of inactive) {
    const sub = index.subBlocks.get(id)
    if (!sub || !isVisible(sub, values)) continue
    const group = sub.canonicalParamId ? index.fields.get(sub.canonicalParamId) : undefined
    const effective = group?.kind === 'pair' ? memberFor(group, modes[group.param] ?? 'basic') : sub
    if (effective !== sub) continue
    ctx.reporter.report(
      'W_INACTIVE_IS_ACTIVE',
      `${id} is visible, so it is not inactive.`,
      rangeOf(ctx, property),
      { hint: 'Move it into params.', blockKey: decl.key, param: id }
    )
  }
  for (const field of index.fields.values()) {
    const members = field.kind === 'single' ? [field.sub] : field.members
    const required = members.some((sub) => isVisible(sub, values) && isRequired(sub, values))
    if (!required || members.some((sub) => Object.hasOwn(params, sub.id))) continue
    const todo = state.todos.get(field.param)
    ctx.reporter.report(
      'W_REQUIRED_MISSING',
      `${field.param} is required.`,
      rangeOf(ctx, todo ?? decl.call),
      {
        hint: `Set ${field.param} before running the workflow.`,
        blockKey: decl.key,
        param: field.param,
      }
    )
  }
}

/** Config keys per container builder, and the CWM field each fills (the printer's forms). */
const CONTAINER_CONFIG: Record<string, Record<string, string>> = {
  'loop.for': { count: 'iterations' },
  'loop.forEach': { collection: 'forEachItems' },
  'loop.while': { condition: 'whileCondition' },
  'loop.doWhile': { condition: 'doWhileCondition' },
  'parallel.count': { count: 'count', batchSize: 'batchSize' },
  'parallel.collection': { collection: 'distribution', batchSize: 'batchSize' },
  parallel: { count: 'count', collection: 'distribution', batchSize: 'batchSize' },
}
const SUBFLOW_FIELDS: Record<'loop' | 'parallel', readonly string[]> = {
  loop: ['iterations', 'forEachItems', 'whileCondition', 'doWhileCondition'],
  parallel: ['count', 'distribution', 'batchSize'],
}
const NUMBER_FIELDS = new Set(['iterations', 'count', 'batchSize'])
const TEXT_FIELDS = new Set(['whileCondition', 'doWhileCondition'])

function numberLiteral(node: Node): number | null {
  if (node.type === 'NumericLiteral') return node.value
  if (
    node.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'NumericLiteral'
  ) {
    return -node.argument.value
  }
  return null
}

/**
 * `loop.<type>(name, config, body, meta?)` / `parallel[.<type>](...)`. Config holds the fields
 * the type uses; the subflow's other stored fields, and any params, sit under `meta.inactive` by
 * their CWM names (build-spec decision 2, A9).
 */
function compileContainer(ctx: CompileContext, decl: BlockDecl): CompiledBlock | null {
  const builder = decl.builder
  if (builder.kind !== 'container') return null
  const site: ValueSite = { decl, scope: decl.scope }
  const [, configNode, , metaNode, ...extra] = decl.call.arguments
  for (const node of extra) {
    unsupported(ctx, node, 'Too many arguments.', 'Pass (name, config, body, meta?).', decl)
  }
  const meta = compileMeta(ctx, metaNode, site)
  const builderKey =
    builder.method === null ? builder.container : `${builder.container}.${builder.method}`
  const configKeys = CONTAINER_CONFIG[builderKey] ?? {}
  const fields = new Map<string, Value>()

  const setField = (field: string, node: Node): void => {
    if (NUMBER_FIELDS.has(field)) {
      const value = numberLiteral(node)
      if (value === null)
        unsupported(ctx, node, `${field} is a number.`, `Write ${field}: 3.`, decl)
      else fields.set(field, value)
      return
    }
    const compiled = compileValue(ctx, node, site)
    if (!compiled || compiled.kind !== 'value') return
    if (TEXT_FIELDS.has(field) && typeof compiled.value !== 'string') {
      unsupported(ctx, node, `${field} is text.`, 'Write js`...`.', decl)
      return
    }
    fields.set(field, compiled.value)
  }

  if (configNode && configNode.type !== 'ObjectExpression') {
    unsupported(ctx, configNode, 'The config is an object literal.', 'Write { count: 3 }.', decl)
  } else if (configNode) {
    for (const [key, property] of objectEntries(ctx, configNode)) {
      const field = configKeys[key]
      if (!field) {
        ctx.reporter.report(
          'E_UNKNOWN_PARAM',
          `This ${builder.container} has no config ${key}.`,
          rangeOf(ctx, property),
          { ...withHint(didYouMean(key, Object.keys(configKeys))), blockKey: decl.key }
        )
        continue
      }
      setField(field, property.value)
    }
  }

  const subflowFields = SUBFLOW_FIELDS[builder.container]
  const activeFields = new Set(Object.values(configKeys))
  const paramEntries: Array<[string, ObjectProperty]> = []
  for (const [key, property] of meta.inactive) {
    if (subflowFields.includes(key) && !activeFields.has(key)) {
      recordSpan(ctx, { kind: 'inactive', block: decl.key, param: key }, property)
      setField(key, property.value)
    } else {
      paramEntries.push([key, property])
    }
  }
  const params: Record<SubBlockId, CanonicalParam> = {}
  const inactive = compileInactive(ctx, paramEntries, params, site)

  const json = (field: string): Json | undefined => fields.get(field) as Json | undefined
  const text = (field: string): string | undefined => {
    const value = fields.get(field)
    return typeof value === 'string' ? value : undefined
  }
  const number = (field: string): number | undefined => {
    const value = fields.get(field)
    return typeof value === 'number' ? value : undefined
  }
  let subflow: LoopSpec | ParallelSpec
  if (builder.container === 'loop') {
    const forEachItems = json('forEachItems')
    const whileCondition = text('whileCondition')
    const doWhileCondition = text('doWhileCondition')
    subflow = {
      kind: 'loop',
      loopType: builder.method as LoopSpec['loopType'],
      iterations: number('iterations') ?? DEFAULT_LOOP_ITERATIONS,
      ...(forEachItems !== undefined && { forEachItems }),
      ...(whileCondition !== undefined && { whileCondition }),
      ...(doWhileCondition !== undefined && { doWhileCondition }),
    }
  } else {
    const count = number('count')
    const distribution = json('distribution')
    const batchSize = number('batchSize')
    subflow = {
      kind: 'parallel',
      ...(builder.method !== null && { parallelType: builder.method as 'count' | 'collection' }),
      ...(count !== undefined && { count }),
      ...(distribution !== undefined && { distribution }),
      ...(batchSize !== undefined && { batchSize }),
    }
  }

  const modes: Record<string, ParamMode> = {}
  for (const [param, mode] of meta.modes) setOwn(modes, param, mode)
  const block: CanonicalBlock = {
    key: decl.key,
    name: decl.name,
    type: builder.container,
    parent: decl.parent?.key ?? null,
    enabled: meta.enabled,
    locked: meta.locked,
    triggerMode: meta.triggerMode ?? false,
    advancedMode: meta.advancedMode,
    errorPort: meta.errorPort,
    retry: meta.retry,
    params,
    modes,
    subflow,
    ...(meta.opaque && { opaque: { data: meta.opaque } }),
  }
  return { block, inactive: inactive.ids }
}

/** Pass 2 for one declaration. `null` for declarations already reported as invalid. */
export function compileBlock(ctx: CompileContext, decl: BlockDecl): CompiledBlock | null {
  if (decl.duplicate || decl.builder.kind === 'unknown') return null
  return decl.builder.kind === 'container'
    ? compileContainer(ctx, decl)
    : compileRegularBlock(ctx, decl)
}
