import type { Node, ObjectExpression, ObjectProperty } from '@babel/types'
import { isRecordLike } from '@sim/utils/object'
import type { BlockRetryConfig, WorkflowBranchKind } from '@sim/workflow-types/workflow'
import { encodeAnchor } from '../anchors'
import { isBranchExtraField } from '../canonicalize/branches'
import {
  DEFAULT_LOOP_ITERATIONS,
  effectiveBatchSize,
  PARALLEL_BATCH_MAX,
  SUBFLOW_DATA_KEYS,
} from '../canonicalize/subflows'
import { canonicalActivityInputs, isInactive } from '../catalog/activity'
import { editorDefaults } from '../catalog/defaults'
import {
  buildFieldIndex,
  type CatalogField,
  declarationFor,
  type FieldIndex,
  isModalPair,
  isWrittenInSource,
  memberFor,
  typedForBuilder,
} from '../catalog/surface'
import type { CatalogBlock, CatalogSubBlock } from '../catalog/types'
import { type CodeFileLanguage, codeFileLanguage, fromCodeFile } from '../code-files'
import { isIdentifierName } from '../code-files/ref-path'
import { branchesAtTopLevel, ELSE_KEY, isElseTrue } from '../forms/condition'
import { inputFormatItems, renamedInputFields, untypedInputFields } from '../forms/input-format'
import { compileResponseParam, usesResponseForm } from '../forms/response'
import { CODE_FILE_EXTENSIONS, utf8Bytes } from '../limits'
import { isJson } from '../lock'
import {
  type AnchorKey,
  type BlockKey,
  type CanonicalBlock,
  type CanonicalBranches,
  type CanonicalBranchRow,
  type CanonicalParam,
  isJsonObject,
  isPlainRecord,
  type Json,
  type LoopSpec,
  type ParallelSpec,
  type ParamMode,
  type SubBlockId,
  type Value,
} from '../model'
import { getOwn, setOwn } from '../records'
import { isLiteralSecret, literalSecretFinding } from '../secrets'
import { checkStorableText } from './characters'
import {
  type BlockDecl,
  type CompileContext,
  catalogBlockOf,
  rangeOf,
  recordSpan,
  unsupported,
} from './context'
import { didYouMean } from './hints'
import { bracketDepthOverflow } from './parse'
import type { Range } from './report'
import { compileToolList } from './tools'
import {
  fieldFor,
  isVisible,
  missingRequiredFields,
  paramLookup,
  valueKindMatches,
} from './validate-catalog'
import {
  type CompiledValue,
  compileJsonField,
  compileJsonLiteral,
  compileValue,
  isSelectorForm,
  nestedValue,
  objectEntries,
  type ValueSite,
} from './values'

interface CompiledBlock {
  block: CanonicalBlock
  /** Repo-relative path of the function-code file, when the code came from `codeFile()`. */
  codeFile?: string
}

const META_KEYS = [
  'key',
  'disabled',
  'locked',
  'advancedMode',
  'triggerMode',
  'errorPort',
  'retry',
  'branches',
  'extra',
  'subflowData',
]
const EDGE_METHOD_NAMES = new Set(['to', 'onError'])

interface CompiledMeta {
  enabled: boolean
  locked: boolean
  errorPort: boolean
  retry: BlockRetryConfig | null
  advancedMode: boolean
  triggerMode: boolean | null
  /** Per-row `title` and `extra` (the printer's meta `branches`). */
  branches: Array<[string, ObjectProperty]>
  /** Stored fields that run but have no SDK syntax (the printer's meta `extra`). */
  extra: Array<[string, ObjectProperty]>
  /** A container's unreadable subflow `block.data` keys (the printer's meta `subflowData`). */
  subflowData: { node: Node; data: Record<string, Json> } | null
}

function booleanLiteral(ctx: CompileContext, property: ObjectProperty, decl: BlockDecl): boolean {
  if (property.value.type === 'BooleanLiteral') return property.value.value
  unsupported(
    ctx,
    property.value,
    'This meta field is a boolean literal.',
    'Write true or false.',
    decl.key
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
  return unsupported(
    ctx,
    node,
    'retry needs enabled, maxTries and waitBetweenTriesMs.',
    'Write retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 1000 }.',
    site.decl.key
  )
}

function objectValue(
  ctx: CompileContext,
  property: ObjectProperty,
  decl: BlockDecl,
  example: string
): ObjectExpression | null {
  if (property.value.type === 'ObjectExpression') return property.value
  return unsupported(
    ctx,
    property.value,
    'Write an object literal here.',
    `Write ${example}.`,
    decl.key
  )
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

/** `meta`: block-level fields, in the printer's vocabulary. */
function compileMeta(ctx: CompileContext, node: Node | undefined, site: ValueSite): CompiledMeta {
  const meta: CompiledMeta = {
    enabled: true,
    locked: false,
    errorPort: false,
    retry: null,
    advancedMode: false,
    triggerMode: null,
    branches: [],
    extra: [],
    subflowData: null,
  }
  if (!node) return meta
  const { decl } = site
  if (node.type !== 'ObjectExpression') {
    unsupported(
      ctx,
      node,
      'Block meta is an object literal.',
      'Write { disabled: true }.',
      decl.key
    )
    return meta
  }
  for (const [key, property] of objectEntries(ctx, node)) {
    switch (key) {
      case 'key':
        break
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
      case 'branches': {
        const branches = objectValue(ctx, property, decl, "branches: { key: { title: '...' } }")
        if (branches) meta.branches = objectEntries(ctx, branches)
        break
      }
      case 'extra': {
        const extra = objectValue(ctx, property, decl, 'extra: { field: value }')
        if (!extra) break
        meta.extra = objectEntries(ctx, extra)
        registerList(
          ctx,
          extra,
          meta.extra,
          (param) => encodeAnchor({ kind: 'param', block: decl.key, param }),
          decl
        )
        break
      }
      case 'subflowData': {
        const json = compileJsonLiteral(ctx, property.value, site)
        if (json === undefined) break
        if (!isJsonObject(json) || Object.keys(json).some((k) => !SUBFLOW_DATA_KEYS.has(k))) {
          unsupported(
            ctx,
            property.value,
            'subflowData holds subflow data keys only.',
            `Keys are ${[...SUBFLOW_DATA_KEYS].join(', ')}.`,
            decl.key
          )
          break
        }
        meta.subflowData = { node: property, data: json }
        break
      }
      default:
        unsupported(
          ctx,
          property,
          `${key} is not a block meta field.`,
          `Meta fields are ${META_KEYS.join(', ')}.`,
          decl.key
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

/** Reads a `codeFile('./x.js')` code file back into stored code. */
function readCodeFile(
  ctx: CompileContext,
  compiled: Extract<CompiledValue, { kind: 'codeFile' }>,
  language: string,
  decl: BlockDecl
): { code: string; path: string } | null {
  const at = rangeOf(ctx, compiled.pathNode)
  const budget = ctx.codeFiles
  budget.refs++
  if (budget.refs > ctx.limits.maxCodeFileRefs) {
    if (budget.refs === ctx.limits.maxCodeFileRefs + 1) {
      ctx.reporter.report(
        'E_LIMIT_EXCEEDED',
        `The workflow has more than ${ctx.limits.maxCodeFileRefs} codeFile() references.`,
        at,
        { hint: 'Write short code inline with js``.', blockKey: decl.key }
      )
    }
    return null
  }
  if (!Object.hasOwn(CODE_FILE_EXTENSIONS, language)) {
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
        hint: "Write codeFile('./functions/name.js') with .js, .py or .sh matching language.",
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
  const cached = budget.reads.get(path)
  if (cached !== undefined) return cached === null ? null : { code: cached, path }
  ctx.reporter.addFile(path, text)
  if (!checkStorableText(path, text, ctx.reporter, decl.key)) {
    budget.reads.set(path, null)
    return null
  }
  const code = parseCodeFile(ctx, path, text, language as CodeFileLanguage, at, decl)
  budget.reads.set(path, code)
  return code === null ? null : { code, path }
}

/**
 * Reads one distinct code file under the total byte cap and, for JavaScript, the bracket-depth cap
 * that keeps Babel's recursive descent off a depth bomb.
 */
function parseCodeFile(
  ctx: CompileContext,
  path: string,
  text: string,
  language: CodeFileLanguage,
  at: Range,
  decl: BlockDecl
): string | null {
  const { limits } = ctx
  ctx.codeFiles.bytes += utf8Bytes(text, limits.maxTotalBytes)
  if (ctx.codeFiles.bytes > limits.maxTotalBytes) {
    ctx.reporter.report(
      'E_LIMIT_EXCEEDED',
      `The workflow and its code files total more than ${limits.maxTotalBytes} bytes.`,
      at,
      { hint: 'Share one code file between blocks, or shorten the code.', blockKey: decl.key }
    )
    return null
  }
  if (language === 'javascript') {
    const overflowAt = bracketDepthOverflow(text, limits.maxDepth)
    if (overflowAt !== -1) {
      ctx.reporter.report(
        'E_LIMIT_EXCEEDED',
        `${path} nests deeper than ${limits.maxDepth} levels.`,
        { file: path, start: overflowAt, end: overflowAt + 1 },
        { blockKey: decl.key }
      )
      return null
    }
  }
  const back = fromCodeFile(text, language)
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
  if (back.refs.length > 0) {
    ctx.codeFiles.chains.push({ path, blockKey: decl.key, refs: back.refs })
  }
  return back.code
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

/** `W_LITERAL_SECRET` on a password field whose value is literal text, written or kept stored. */
function reportLiteralSecret(
  ctx: CompileContext,
  blockKey: BlockKey,
  entry: Pick<WrittenParam, 'property' | 'param'>
): void {
  const { message, hint } = literalSecretFinding(entry.param)
  ctx.reporter.report('W_LITERAL_SECRET', message, rangeOf(ctx, entry.property), {
    hint,
    blockKey,
    param: entry.param,
  })
}

/** The site for one field: variables-input fields read bare `vars.k` as the variable itself. */
function fieldSite(site: ValueSite, sub: CatalogSubBlock | undefined): ValueSite {
  return sub?.structured === 'variables' ? { ...site, varNodes: true } : site
}

/** Rows from branch entries: `else: true` is the empty else. */
function compileBranchRows(
  ctx: CompileContext,
  entries: Array<[string, ObjectProperty]>,
  kind: WorkflowBranchKind,
  block: CatalogBlock | undefined,
  site: ValueSite
): CanonicalBranchRow[] {
  const { decl } = site
  const outputs = new Set(Object.keys(block?.outputs ?? {}))
  const rows: CanonicalBranchRow[] = []
  const refused = new Set<string>()
  ctx.refusedBranches.set(decl.key, refused)
  for (const [index, [key, property]] of entries.entries()) {
    recordSpan(ctx, { kind: 'param', block: decl.key, param: key }, property)
    if (!isIdentifierName(key)) {
      unsupported(
        ctx,
        property,
        `${key} is not a valid branch key.`,
        'Branch keys are JS identifiers.',
        decl.key
      )
      refused.add(key)
      continue
    }
    if (outputs.has(key) || EDGE_METHOD_NAMES.has(key)) {
      ctx.reporter.report(
        'E_BRANCH_KEY_COLLIDES',
        `The branch ${key} collides with ${outputs.has(key) ? 'an output' : 'an edge method'} of this block.`,
        rangeOf(ctx, property),
        { hint: 'Rename the branch.', blockKey: decl.key }
      )
      refused.add(key)
      continue
    }
    if (isElseTrue(kind, key, index === entries.length - 1, property.value)) {
      rows.push({ key, value: '' })
      continue
    }
    if (kind === 'condition' && property.value.type === 'BooleanLiteral') {
      refused.add(key)
      unsupported(
        ctx,
        property.value,
        `Only the last branch, else, is true; ${key} needs a condition.`,
        key === ELSE_KEY
          ? 'Move else to the end.'
          : `Write ${key}: js\`...\`, or rename it else and move it to the end.`,
        decl.key
      )
      continue
    }
    const compiled = compileValue(ctx, property.value, site)
    if (compiled?.kind === 'value' && typeof compiled.value === 'string') {
      rows.push({ key, value: compiled.value })
      continue
    }
    if (compiled)
      unsupported(
        ctx,
        property.value,
        'A branch value is text.',
        'Write a string or a js`` template.',
        decl.key
      )
    refused.add(key)
  }
  const last = entries[entries.length - 1]
  if (kind === 'condition' && entries.length >= 2 && last && last[0] !== ELSE_KEY) {
    ctx.reporter.report(
      'E_BRANCH_ELSE_LAST',
      'A condition with two or more branches ends with else.',
      rangeOf(ctx, last[1]),
      { hint: 'Add else: true as the last branch.', blockKey: decl.key }
    )
  }
  return rows
}

/**
 * Applies meta `branches: { key: { title?, extra? } }` to the rows. `title: null` is a row stored
 * with no title, which the executor never takes for `else`.
 */
function applyBranchMeta(
  ctx: CompileContext,
  rows: CanonicalBranchRow[] | null,
  entries: Array<[string, ObjectProperty]>,
  site: ValueSite
): void {
  for (const [key, property] of entries) {
    const row = rows?.find((candidate) => candidate.key === key)
    if (!row && ctx.refusedBranches.get(site.decl.key)?.has(key)) continue
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
      !isJsonObject(json) ||
      Object.keys(json).some((field) => field !== 'title' && field !== 'extra') ||
      (json.title !== undefined && json.title !== null && typeof json.title !== 'string') ||
      (json.extra !== undefined && !isJsonObject(json.extra))
    ) {
      unsupported(
        ctx,
        property.value,
        'Branch meta is { title?, extra? }.',
        "Write { title: 'Label' } or { extra: { key: value } }.",
        site.decl.key
      )
      continue
    }
    const reserved = isRecordLike(json.extra)
      ? Object.keys(json.extra).filter((field) => !isBranchExtraField(field))
      : []
    if (reserved.length > 0) {
      unsupported(
        ctx,
        property.value,
        `Branch extra cannot hold ${reserved.join(', ')}: the branch's id, title, condition and key are set by the source.`,
        'Remove those fields from extra; write the title with title.',
        site.decl.key
      )
      continue
    }
    if (typeof json.title === 'string') row.titleOverride = json.title
    if (json.title === null) row.titleMissing = true
    if (isJsonObject(json.extra)) row.extra = json.extra
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
  /**
   * Subblock ids written as `null` or `todo()`: stored-absent on purpose, so the editor default
   * never fills them.
   */
  unset: Set<SubBlockId>
  pendingFile: { compiled: Extract<CompiledValue, { kind: 'codeFile' }>; target: SubBlockId } | null
}

/** How `pairMode` sees any object or array literal. */
const LITERAL_CONTAINER: CompiledValue = { kind: 'value', value: [], form: 'literal' }

function isJsonContainer(value: Value): boolean {
  return Array.isArray(value) || isPlainRecord(value)
}

/**
 * The member a pair value compiles into: a selector call (or a non-empty
 * array of them) is basic, anything else advanced. A literal the derived member's value kind does
 * not take lands in the other member when that one takes it (an uploaded file object in the agent's
 * upload member, not its text twin). A list or object literal never lands in a JSON code member
 * when the pair's other member takes it as written: the printer writes a JSON code member's value
 * as the text it stores, never as the literal it stringifies.
 */
function pairMode(field: Extract<CatalogField, { kind: 'pair' }>, value: CompiledValue): ParamMode {
  if (value.kind !== 'value') return 'basic'
  const derived: ParamMode = isSelectorForm(value.form) ? 'basic' : 'advanced'
  if (value.form !== 'literal') return derived
  const other: ParamMode = derived === 'basic' ? 'advanced' : 'basic'
  const derivedMember = memberFor(field, derived)
  const otherMember = other === 'basic' ? field.basic : field.advanced
  if (!otherMember) return derived
  if (
    derivedMember &&
    !valueKindMatches(derivedMember, value.value) &&
    valueKindMatches(otherMember, value.value)
  ) {
    return other
  }
  if (!isJsonContainer(value.value)) return derived
  return derivedMember?.type === 'code' && otherMember.type !== 'code' ? other : derived
}

/**
 * `stored()`: the param keeps what the stored block holds (`CompileInput.stored`), a pair its
 * members and mode, without the value ever appearing in source. Only a block the stored workflow
 * already has under this key and type, holding a value for the param, can keep one.
 */
function keepStored(
  ctx: CompileContext,
  state: BlockState,
  members: ReadonlyArray<{ id: SubBlockId; password?: boolean }>,
  property: ObjectProperty,
  field: CatalogField | null
): void {
  const { decl, params, modes } = state
  const stored = ctx.stored ? getOwn(ctx.stored.blocks, decl.key) : undefined
  const name = field?.name ?? members[0]?.id ?? ''
  const type =
    decl.builder.kind === 'container' || decl.builder.kind === 'unknown' ? null : decl.builder.type
  if (!stored || stored.type !== type || !members.some(({ id }) => getOwn(stored.params, id))) {
    ctx.reporter.report(
      'E_STORED_VALUE_MISSING',
      stored && stored.type === type
        ? `stored() keeps ${name}, but the stored ${decl.name} has no value for it.`
        : `stored() keeps a stored value, but ${decl.name} is not a stored block of this type.`,
      rangeOf(ctx, property.value),
      { hint: `Write the value of ${name}.`, blockKey: decl.key, param: name }
    )
    return
  }
  for (const member of members) {
    const param = getOwn(stored.params, member.id)
    if (param) setOwn(params, member.id, param)
    else state.unset.add(member.id)
    if (param?.kind === 'value' && member.password && isLiteralSecret(param.value)) {
      reportLiteralSecret(ctx, decl.key, { property, param: name })
    }
  }
  const mode = field && isModalPair(field) ? getOwn(stored.modes, field.param) : undefined
  if (field && mode) setOwn(modes, field.param, mode)
}

/** Compiles one catalog param into its member subBlock (`pairMode` picks a pair's member). */
function compileField(
  ctx: CompileContext,
  state: BlockState,
  field: CatalogField,
  property: ObjectProperty
): void {
  const { decl, params, modes } = state
  const firstSub = field.kind === 'single' ? field.sub : field.members[0]
  const site = fieldSite(state.site, firstSub)
  if (firstSub?.valueKind === 'tools') {
    const storedBlock = ctx.stored ? getOwn(ctx.stored.blocks, decl.key) : undefined
    const storedParam = storedBlock ? getOwn(storedBlock.params, firstSub.id) : undefined
    const storedTools =
      storedBlock?.type === catalogBlockOf(decl)?.type && storedParam?.kind === 'tools'
        ? storedParam.tools
        : []
    const tools = compileToolList(ctx, property.value, site, storedTools)
    if (tools) setOwn(params, firstSub.id, { kind: 'tools', tools })
    return
  }
  if (property.value.type === 'ObjectExpression' || property.value.type === 'ArrayExpression') {
    const mode = field.kind === 'pair' ? pairMode(field, LITERAL_CONTAINER) : null
    const jsonTarget =
      field.kind === 'pair' && mode
        ? memberFor(field, mode)
        : field.kind === 'single'
          ? field.sub
          : undefined
    if (jsonTarget?.type === 'code') {
      const value = compileJsonField(ctx, property.value, site, params, jsonTarget.id)
      if (value === undefined) return
      if (mode && isModalPair(field)) setOwn(modes, field.param, mode)
      state.written.push({
        property,
        param: field.name,
        target: jsonTarget.id,
        checked: false,
        value,
      })
      return
    }
  }
  const compiled = compileValue(ctx, property.value, site)
  if (!compiled) return
  if (compiled.kind === 'absent' || compiled.kind === 'todo') {
    for (const member of field.kind === 'pair' ? field.members : [field.sub])
      state.unset.add(member.id)
    if (compiled.kind === 'todo') state.todos.set(field.name, property)
    return
  }
  if (compiled.kind === 'stored') {
    keepStored(ctx, state, field.kind === 'single' ? [field.sub] : field.members, property, field)
    return
  }
  if (compiled.kind === 'codeFile') {
    if (field.kind !== 'single' || field.sub.type !== 'code') {
      unsupported(
        ctx,
        property.value,
        'codeFile() holds a function block code.',
        "Write code: codeFile('./functions/x.js').",
        decl.key
      )
      return
    }
    state.pendingFile = { compiled, target: field.sub.id }
    return
  }

  let target: CatalogSubBlock | undefined
  if (field.kind === 'pair') {
    const mode = pairMode(field, compiled)
    if (isModalPair(field)) setOwn(modes, field.param, mode)
    target = memberFor(field, mode)
  } else {
    target = field.sub
  }
  if (!target) return

  let value = compiled.value
  const checked = compiled.form === 'literal'
  if (target.structured === 'inputFormat' && compiled.form === 'literal') {
    for (const renamed of renamedInputFields(value)) {
      unsupported(
        ctx,
        property.value,
        `The ${renamed.key} field also writes name ${JSON.stringify(renamed.name)}; the key names the field.`,
        `Rename the key, or remove name from ${renamed.key}.`,
        decl.key
      )
    }
    for (const key of untypedInputFields(value)) {
      unsupported(
        ctx,
        property.value,
        `The ${key} field names no type.`,
        `Write ${key}: 'string', or ${key}: { type: 'number', value: 5 }.`,
        decl.key
      )
    }
    value = inputFormatItems(value)
  }
  setOwn(params, target.id, { kind: 'value', value })
  state.written.push({ property, param: field.name, target: target.id, checked, value })
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
    unsupported(ctx, node, 'Too many arguments.', 'Pass (name, params, meta?).', decl.key)
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
    unset: new Set(),
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
  const conditionForm = branchesAtTopLevel(branchField?.kind, builder.kind === 'catalog')

  if (paramsNode && paramsNode.type !== 'ObjectExpression') {
    unsupported(
      ctx,
      paramsNode,
      'Params are an object literal.',
      'Write { field: value }.',
      decl.key
    )
  }
  const paramsObject = paramsNode?.type === 'ObjectExpression' ? paramsNode : undefined
  const branchEntries: Array<[string, ObjectProperty]> = []
  let responseBody = false
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
    const writtenFields = new Set<CatalogField>()
    responseBody =
      builder.kind === 'catalog' &&
      usesResponseForm(
        builder.type,
        entries.map(([key]) => key)
      )
    for (const [key, property] of entries) {
      const field = index ? fieldFor(index, key) : undefined
      const name = field?.name ?? key
      addItem(property, encodeAnchor({ kind: 'param', block: decl.key, param: name }))
      recordSpan(ctx, { kind: 'param', block: decl.key, param: name }, property)
      if (branchField && key === branchField.subBlockId) {
        if (property.value.type !== 'ObjectExpression') {
          unsupported(
            ctx,
            property.value,
            'Branches are an object literal.',
            'Write { if: js`...`, else: true }.',
            decl.key
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
      if (responseBody) {
        compileResponseParam(ctx, site, params, key, property)
        continue
      }
      if (conditionForm && !field && !pinned.has(key)) {
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
        if (compiled.kind === 'stored') {
          keepStored(ctx, state, [{ id: key }], property, null)
          continue
        }
        if (compiled.kind === 'codeFile') {
          unsupported(
            ctx,
            property.value,
            'codeFile() needs a catalog block type.',
            'Write the code inline.',
            decl.key
          )
          continue
        }
        setOwn(params, key, { kind: 'value', value: compiled.value })
        continue
      }
      if (!field) {
        const alias = index.memberAliases.get(key)
        ctx.reporter.report(
          'E_UNKNOWN_PARAM',
          `${catalogBlock?.name ?? decl.key} has no param ${key}.`,
          rangeOf(ctx, property),
          {
            hint: alias
              ? `Write it as ${alias}; the value kind picks the basic or advanced field.`
              : didYouMean(key, index.fields.keys()),
            blockKey: decl.key,
            param: key,
          }
        )
        continue
      }
      if (writtenFields.has(field)) {
        unsupported(
          ctx,
          property,
          `${key} names the param ${field.name}, which is already written.`,
          `Write ${field.name} once.`,
          decl.key
        )
        continue
      }
      writtenFields.add(field)
      compileField(ctx, state, field, property)
    }
  }
  if (responseBody) setOwn(params, 'dataMode', { kind: 'value', value: 'json' })
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
      decl.key
    )
  }

  let codeFile: string | undefined
  if (state.pendingFile) {
    const languageParam = params.language
    const omittedLanguage =
      catalogBlock && !state.unset.has('language')
        ? editorDefaults(catalogBlock).get('language')
        : undefined
    const language =
      languageParam?.kind === 'value' && typeof languageParam.value === 'string'
        ? languageParam.value
        : typeof omittedLanguage === 'string'
          ? omittedLanguage
          : 'javascript'
    const read = readCodeFile(ctx, state.pendingFile.compiled, language, decl)
    if (read) {
      setOwn(params, state.pendingFile.target, { kind: 'value', value: read.code })
      codeFile = read.path
    }
  }

  for (const field of index?.fields.values() ?? []) {
    if (isModalPair(field) && !Object.hasOwn(modes, field.param))
      setOwn(modes, field.param, 'basic')
  }

  const pinnedValues: Record<string, unknown> = {}
  for (const id of pinned) setOwn(pinnedValues, id, storedValues(params).get(id))
  compileExtraParams(
    ctx,
    meta.extra,
    state,
    (id) => {
      if (pinned.has(id) || id === branchField?.subBlockId) return true
      const declarations = index?.declarations.get(id)
      return declarations !== undefined && typedForBuilder(declarations, pinnedValues)
    },
    (id, property) =>
      keepStored(ctx, state, index?.declarations.get(id) ?? [{ id }], property, null)
  )
  if (meta.subflowData) {
    unsupported(
      ctx,
      meta.subflowData.node,
      'Only a loop or parallel has subflowData.',
      'Remove subflowData; apply keeps the stored block data.',
      decl.key
    )
  }
  const fromSource = new Set(Object.keys(params))
  const defaulted: SubBlockId[] = []
  if (catalogBlock) {
    for (const [id, value] of editorDefaults(catalogBlock)) {
      if (Object.hasOwn(params, id) || state.unset.has(id) || pinned.has(id)) continue
      if (id === branchField?.subBlockId) continue
      setOwn(params, id, { kind: 'value', value })
      defaulted.push(id)
    }
  }
  if (index) checkFields(ctx, index, state)
  if (builder.type === SCHEDULE_BLOCK_TYPE) checkScheduleTimezone(ctx, state)

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
  }
  if (catalogBlock) {
    keepStoredInactiveParams(ctx, block, catalogBlock, defaulted)
    keepStoredUnwrittenParams(ctx, block, catalogBlock, fromSource)
  }
  return { block, ...(codeFile !== undefined && { codeFile }) }
}

/**
 * The printer leaves out a param that never executes, so source omitting one of a stored block's
 * params means "keep what is stored", not "take the editor default": a default-filled param that
 * is inactive takes the stored block's value, or none when the stored block has none. A block the
 * stored workflow does not hold keeps the defaults, as canvas creation seeds them.
 */
function keepStoredInactiveParams(
  ctx: CompileContext,
  block: CanonicalBlock,
  catalogBlock: CatalogBlock,
  defaulted: readonly SubBlockId[]
): void {
  if (defaulted.length === 0) return
  const stored = ctx.stored ? getOwn(ctx.stored.blocks, block.key) : undefined
  if (!stored || stored.type !== block.type) return
  const inputs = canonicalActivityInputs(block, catalogBlock, ctx.catalog)
  for (const id of defaulted) {
    if (!isInactive(id, inputs)) continue
    const kept = getOwn(stored.params, id)
    if (kept) setOwn(block.params, id, kept)
    else delete block.params[id]
  }
}

/**
 * Source never states a field it does not write (`isWrittenInSource`: hidden, display-only and
 * trigger system fields), so a block the stored workflow holds keeps the stored value of each such
 * field source left out, or none when the stored block has none. A block the stored workflow does
 * not hold keeps the defaults, as canvas creation seeds them.
 */
function keepStoredUnwrittenParams(
  ctx: CompileContext,
  block: CanonicalBlock,
  catalogBlock: CatalogBlock,
  fromSource: ReadonlySet<SubBlockId>
): void {
  const stored = ctx.stored ? getOwn(ctx.stored.blocks, block.key) : undefined
  if (!stored || stored.type !== block.type) return
  const index = buildFieldIndex(catalogBlock, block.triggerMode, new Set())
  for (const [id, declarations] of index.declarations) {
    if (fromSource.has(id) || declarations.some(isWrittenInSource)) continue
    const kept = getOwn(stored.params, id)
    if (kept) setOwn(block.params, id, kept)
    else delete block.params[id]
  }
}

/**
 * `meta.extra` entries that become params: stored ids with no SDK syntax that still run (a
 * schema-agnostic custom block's input, the agent's legacy prompt fields, a container's stored
 * params, a param the builder's type leaves out (`typedForBuilder`) that still runs). An id the
 * builder's params can name (`typed`) or already hold is refused; `null` leaves the id unset, so
 * no editor default fills it, and `stored()` keeps the stored value (`keep`).
 */
function compileExtraParams(
  ctx: CompileContext,
  entries: Array<[string, ObjectProperty]>,
  state: Pick<BlockState, 'params' | 'site' | 'unset'>,
  typed: (id: SubBlockId) => boolean,
  keep?: (id: SubBlockId, property: ObjectProperty) => void
): void {
  const { site, params } = state
  const { decl } = site
  for (const [id, property] of entries) {
    if (typed(id) || Object.hasOwn(params, id)) {
      unsupported(
        ctx,
        property,
        `${id} is a param of this block, not an extra field.`,
        'Write it in params.',
        decl.key
      )
      continue
    }
    recordSpan(ctx, { kind: 'param', block: decl.key, param: id }, property)
    const compiled = compileValue(ctx, property.value, site)
    if (compiled?.kind === 'value') setOwn(params, id, { kind: 'value', value: compiled.value })
    else if (compiled?.kind === 'absent') state.unset.add(id)
    else if (compiled?.kind === 'stored' && keep) keep(id, property)
    else if (compiled) nestedValue(ctx, property.value, compiled, site)
  }
}

/**
 * Why a literal table filter would fail at run time, or `null`. The runtime reads an array as
 * builder rows (`filterRulesToPredicate`) and anything else as a predicate it validates
 * (`validatePredicateShape`), which refuses the legacy `{ column: { $op: value } }` grammar.
 */
function tableFilterProblem(value: Value): string | null {
  if (Array.isArray(value)) {
    const predicateRow = value.some(
      (row) => isPlainRecord(row) && !('column' in row) && ('field' in row || 'op' in row)
    )
    return predicateRow
      ? 'A filter row is a predicate condition ({ field, op }) written as a builder row; the runtime refuses the mix.'
      : null
  }
  return isPlainRecord(value) ? predicateProblem(value) : null
}

function predicateProblem(node: Record<string, Value>): string | null {
  const group = node.all ?? node.any
  if (group !== undefined) {
    if (!Array.isArray(group))
      return 'A filter group ({ all | any }) must hold a list of conditions.'
    for (const member of group) {
      const problem = isPlainRecord(member)
        ? predicateProblem(member)
        : 'A filter group member must be a condition or a group.'
      if (problem !== null) return problem
    }
    return null
  }
  if ('field' in node) return null
  const legacy = Object.entries(node).some(
    ([key, member]) => key.startsWith('$') || isPlainRecord(member)
  )
  return legacy
    ? 'This filter uses the legacy operator-object grammar ({ column: { $eq: value } }), which the table runtime refuses.'
    : 'A filter must be builder rows, a condition ({ field, op, value }) or an all/any group.'
}

/** The schedule trigger, whose `timezone` the editor seeds per viewer (`valueScope: 'viewer'`). */
const SCHEDULE_BLOCK_TYPE = 'schedule'

/**
 * A schedule created from source with no `timezone` runs in UTC: the zone the editor seeds is the
 * viewer's own, so source never gets one by default (`I_SCHEDULE_UTC`).
 */
function checkScheduleTimezone(ctx: CompileContext, state: BlockState): void {
  const { decl, params } = state
  if (ctx.stored && getOwn(ctx.stored.blocks, decl.key)) return
  const timezone = getOwn(params, 'timezone')
  if (timezone?.kind === 'value' && timezone.value !== null && timezone.value !== '') return
  ctx.reporter.report(
    'I_SCHEDULE_UTC',
    'No timezone is set, so this schedule runs in UTC.',
    rangeOf(ctx, decl.call),
    {
      hint: "Set timezone, e.g. timezone: 'America/New_York'.",
      blockKey: decl.key,
      param: 'timezone',
    }
  )
}

/** Catalog warnings: visibility, required fields, value kinds. */
function checkFields(ctx: CompileContext, index: FieldIndex, state: BlockState): void {
  const { decl, params } = state
  const values = storedValues(params)
  const lookup = paramLookup(values)
  for (const entry of state.written) {
    const sub = declarationFor(index, entry.target, lookup)
    if (!sub) continue
    if (!isVisible(sub, values)) {
      ctx.reporter.report(
        'W_FIELD_NOT_APPLICABLE',
        `${entry.param} is hidden under the block's current values; it is kept but not used.`,
        rangeOf(ctx, entry.property),
        {
          hint: 'Remove it; apply keeps the stored value.',
          blockKey: decl.key,
          param: entry.param,
        }
      )
    }
    const filterProblem =
      entry.checked && sub.tableFilter === true ? tableFilterProblem(entry.value) : null
    if (filterProblem !== null) {
      ctx.reporter.report('W_TABLE_FILTER_SHAPE', filterProblem, rangeOf(ctx, entry.property), {
        hint: "Write builder rows [{ column: 'status', operator: 'eq', value: 'open' }] or a predicate { field: 'status', op: 'eq', value: 'open' } (all/any groups for several).",
        blockKey: decl.key,
        param: entry.param,
      })
    }
    if (sub.password && isLiteralSecret(entry.value)) reportLiteralSecret(ctx, decl.key, entry)
    if (entry.checked && !valueKindMatches(sub, entry.value)) {
      ctx.reporter.report(
        'W_VALUE_KIND',
        `${entry.param} expects a ${sub.valueKind} value; the value is kept as written.`,
        rangeOf(ctx, entry.property),
        { blockKey: decl.key, param: entry.param }
      )
    }
  }
  for (const field of missingRequiredFields(index, values, (id) => Object.hasOwn(params, id))) {
    const todo = state.todos.get(field.name)
    ctx.reporter.report(
      'W_REQUIRED_MISSING',
      `${field.name} is required.`,
      rangeOf(ctx, todo ?? decl.call),
      {
        hint: `Set ${field.name} before running the workflow.`,
        blockKey: decl.key,
        param: field.name,
      }
    )
  }
}

/** Config keys per container builder, and the CWM field each fills (the printer's forms). */
const CONTAINER_CONFIG: Record<string, Record<string, string>> = {
  'loop.for': { count: 'iterations' },
  'loop.forEach': { collection: 'forEachItems' },
  'loop.while': { condition: 'whileCondition' },
  'loop.doWhile': { condition: 'doWhileCondition', count: 'iterations' },
  'parallel.count': { count: 'count', batchSize: 'batchSize' },
  'parallel.collection': { collection: 'distribution', batchSize: 'batchSize' },
  parallel: { count: 'count', collection: 'distribution', batchSize: 'batchSize' },
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
 * `W_SUBFLOW_COUNT` for a value the runtime does not run as written: a batch size the runtime
 * clamps (`effectiveBatchSize`, the executable model's rule), and a count that is not a whole
 * number of at least 1 (it runs 5 for `0`, and none or a rounded-up number for a negative or
 * fractional count, which the executable model's `count || 5` does not capture). A warning,
 * because canonicalize keeps such stored values raw.
 */
function checkSubflowCount(
  ctx: CompileContext,
  decl: BlockDecl,
  key: string,
  value: number,
  node: Node
): void {
  if (key === 'batchSize') {
    const effective = effectiveBatchSize(value)
    if (effective === value) return
    ctx.reporter.report(
      'W_SUBFLOW_COUNT',
      `A batch size of ${value} runs as ${effective}.`,
      rangeOf(ctx, node),
      { hint: `Write a whole number from 1 to ${PARALLEL_BATCH_MAX}.`, blockKey: decl.key }
    )
    return
  }
  if (Number.isInteger(value) && value >= 1) return
  ctx.reporter.report(
    'W_SUBFLOW_COUNT',
    `A count of ${value} does not run as written.`,
    rangeOf(ctx, node),
    { hint: `Write a whole number of at least 1, e.g. ${key}: 3.`, blockKey: decl.key }
  )
}

/**
 * `loop.<type>(name, config, body, meta?)` / `parallel[.<type>](...)`. Config holds the fields
 * the type uses; apply keeps the other types' fields from the stored workflow. `meta.extra` holds
 * the container's stored params, and `meta.subflowData` the subflow keys of `block.data`
 * canonicalize could not read as config.
 */
function compileContainer(ctx: CompileContext, decl: BlockDecl): CompiledBlock | null {
  const builder = decl.builder
  if (builder.kind !== 'container') return null
  const site: ValueSite = { decl, scope: decl.scope }
  const [, configNode, , metaNode, ...extra] = decl.call.arguments
  for (const node of extra) {
    unsupported(ctx, node, 'Too many arguments.', 'Pass (name, config, body, meta?).', decl.key)
  }
  const meta = compileMeta(ctx, metaNode, site)
  const builderKey =
    builder.method === null ? builder.container : `${builder.container}.${builder.method}`
  const configKeys = CONTAINER_CONFIG[builderKey] ?? {}
  const fields = new Map<string, Value>()

  const setField = (key: string, field: string, node: Node): void => {
    if (NUMBER_FIELDS.has(field)) {
      const value = numberLiteral(node)
      if (value === null) {
        unsupported(ctx, node, `${field} is a number.`, `Write ${field}: 3.`, decl.key)
        return
      }
      checkSubflowCount(ctx, decl, key, value, node)
      fields.set(field, value)
      return
    }
    const compiled = compileValue(ctx, node, site)
    if (!compiled || compiled.kind !== 'value') return
    if (TEXT_FIELDS.has(field) && typeof compiled.value !== 'string') {
      unsupported(ctx, node, `${field} is text.`, 'Write js`...`.', decl.key)
      return
    }
    fields.set(field, compiled.value)
  }

  if (configNode && configNode.type !== 'ObjectExpression') {
    unsupported(
      ctx,
      configNode,
      'The config is an object literal.',
      'Write { count: 3 }.',
      decl.key
    )
  } else if (configNode) {
    for (const [key, property] of objectEntries(ctx, configNode)) {
      const field = configKeys[key]
      if (!field) {
        ctx.reporter.report(
          'E_UNKNOWN_PARAM',
          `This ${builder.container} has no config ${key}.`,
          rangeOf(ctx, property),
          { hint: didYouMean(key, Object.keys(configKeys)), blockKey: decl.key }
        )
        continue
      }
      setField(key, field, property.value)
    }
  }

  const params: Record<SubBlockId, CanonicalParam> = {}
  compileExtraParams(ctx, meta.extra, { params, site, unset: new Set() }, () => false)

  const json = (field: string): Json | undefined => {
    const value = fields.get(field)
    return isJson(value) ? value : undefined
  }
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
      loopType: builder.method,
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
      ...(builder.method !== null && { parallelType: builder.method }),
      ...(count !== undefined && { count }),
      ...(distribution !== undefined && { distribution }),
      ...(batchSize !== undefined && { batchSize }),
    }
  }

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
    modes: {},
    subflow,
    ...(meta.subflowData && { extra: meta.subflowData.data }),
  }
  return { block }
}

/** Pass 2 for one declaration. `null` for declarations already reported as invalid. */
export function compileBlock(ctx: CompileContext, decl: BlockDecl): CompiledBlock | null {
  if (decl.duplicate || decl.builder.kind === 'unknown') return null
  return decl.builder.kind === 'container'
    ? compileContainer(ctx, decl)
    : compileRegularBlock(ctx, decl)
}
