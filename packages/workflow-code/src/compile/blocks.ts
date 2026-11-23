import { parse } from '@babel/parser'
import type { Node, ObjectExpression, ObjectProperty } from '@babel/types'
import { isRecordLike } from '@sim/utils/object'
import { utf8ByteLength } from '@sim/utils/paste'
import {
  findWorkflowReferenceTokens,
  isLikelyWorkflowReferenceSegment,
} from '@sim/utils/workflow-references'
import {
  BLOCK_RETRY_MAX_TRIES,
  BLOCK_RETRY_MAX_WAIT_MS,
  BLOCK_RETRY_MIN_TRIES,
  BLOCK_RETRY_MIN_WAIT_MS,
  type BlockRetryConfig,
  normalizeWorkflowBlockName,
  type WorkflowBranchKind,
} from '@sim/workflow-types/workflow'
import { encodeAnchor } from '../anchors'
import { babelErrorShape } from '../babel'
import { isBranchExtraField } from '../canonicalize/branches'
import {
  DEFAULT_LOOP_ITERATIONS,
  effectiveBatchSize,
  PARALLEL_BATCH_MAX,
  SUBFLOW_DATA_KEYS,
} from '../canonicalize/subflows'
import { REFERENCE_CANDIDATE } from '../canonicalize/values'
import { canonicalActivityInputs, isInactive, withStoredValue } from '../catalog/activity'
import { editorDefaults } from '../catalog/defaults'
import {
  builderPins,
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
import { catalogBuildersOfType } from '../catalog/view'
import {
  type CodeFileLanguage,
  type CodeFileRef,
  codeFileLanguage,
  fromCodeFile,
} from '../code-files'
import { isIdentifierName, LOOP_PROPERTIES, parseStoredPath } from '../code-files/ref-path'
import { branchesAtTopLevel, ELSE_KEY, isElseTrue } from '../forms/condition'
import { compileResponseParam, usesResponseForm } from '../forms/response'
import { type ConfigField, type ContainerForm, loopForm, parallelForm } from '../forms/subflow'
import { CODE_FILE_EXTENSIONS, isCodeFilePath, SOURCE_CODE_DIR } from '../limits'
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
import { BLOCK_META_KEYS, RESPONSE_BODY_KEYS, SDK_RESOURCE_CALLS } from '../sdk'
import { holdsSecret, literalSecretFinding } from '../secrets'
import { structuredCodec } from '../structured'
import { checkStorableText } from './characters'
import {
  type BlockDecl,
  type CompileContext,
  catalogBlockOf,
  EDGE_METHODS,
  type ResolvedBuilder,
  rangeOf,
  recordSpan,
  unsupported,
} from './context'
import { closest, didYouMean } from './hints'
import { babelMessage, bracketDepthOverflow } from './parse'
import type { Range } from './report'
import { compileToolList } from './tools'
import {
  fieldFor,
  hiddenReason,
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

/** Whether `value` is a whole number from `min` to `max`. */
function wholeNumberIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

/**
 * `meta.retry`, written whole. Its numbers must already lie in the bounds every reader pins them
 * to (`normalizeBlockRetryTries`, `normalizeBlockRetryWaitMs`): persistence stores the policy
 * verbatim but loads it clamped, so an out-of-range value would read back changed and every
 * re-apply would show a retry change.
 */
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
    if (
      !wholeNumberIn(json.maxTries, BLOCK_RETRY_MIN_TRIES, BLOCK_RETRY_MAX_TRIES) ||
      !wholeNumberIn(json.waitBetweenTriesMs, BLOCK_RETRY_MIN_WAIT_MS, BLOCK_RETRY_MAX_WAIT_MS)
    ) {
      return unsupported(
        ctx,
        node,
        'retry is outside the range a workflow stores; loading it would change it.',
        `Write maxTries as a whole number from ${BLOCK_RETRY_MIN_TRIES} to ${BLOCK_RETRY_MAX_TRIES} and waitBetweenTriesMs as a whole number from ${BLOCK_RETRY_MIN_WAIT_MS} to ${BLOCK_RETRY_MAX_WAIT_MS}.`,
        site.decl.key
      )
    }
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
          `Meta fields are ${BLOCK_META_KEYS.join(', ')}.`,
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
  const entryName = ctx.file.slice(ctx.file.lastIndexOf('/') + 1)
  const fromEntry = resolveRelative(entryName, compiled.path)
  if (path === null || fromEntry === null || !isCodeFilePath(fromEntry)) {
    ctx.reporter.report(
      'E_CODE_FILE_PATH',
      path === null
        ? `${compiled.path} is not a relative path inside the repository.`
        : `${compiled.path} is not a code file path a workflow directory holds.`,
      at,
      {
        hint: `Name it ./${SOURCE_CODE_DIR}/<name>.js (or .py, .sh): one file directly in ${SOURCE_CODE_DIR}/ beside ${entryName}, its name letters, digits, _, $, - and dots, not starting with a dot.`,
        blockKey: decl.key,
      }
    )
    return null
  }
  if (codeFileLanguage(compiled.path) !== language) {
    ctx.reporter.report(
      'E_CODE_FILE_PATH',
      `${compiled.path} does not match the block language ${language}.`,
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
  if (cached !== undefined) {
    if (cached === null) return null
    budget.sharedReads.push({ path, blockKey: decl.key })
    return { code: cached, path }
  }
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
  const before = ctx.codeFiles.bytes
  ctx.codeFiles.bytes += utf8ByteLength(text, limits.maxTotalBytes)
  if (ctx.codeFiles.bytes > limits.maxTotalBytes) {
    // Reported once, on the file that crosses the cap; each file after it is skipped silently.
    if (before > limits.maxTotalBytes) return null
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
  if (language !== 'javascript') reportScriptRefSyntax(ctx, path, text, language, decl.key)
  const refs = [...back.refs, ...referenceTags(text)].sort((a, b) => a.start - b.start)
  if (refs.length > 0) ctx.codeFiles.chains.push({ path, blockKey: decl.key, refs })
  return back.code
}

/** A `$ref` chain or `$env` name, as a JavaScript code file writes one. */
const SCRIPT_REF = /\$(ref|env)((?:\.[A-Za-z0-9_$-]+)+)/g

const SCRIPT_LANGUAGE_LABEL: Record<Exclude<CodeFileLanguage, 'javascript'>, string> = {
  python: 'Python',
  shell: 'Shell',
}

/**
 * Whether a `$ref`/`$env` match in a Python or shell file is a reference rather than the
 * language's own text (a shell variable `$ref` before `.txt`): `$ref` needs a path under a block,
 * `loop`, `parallel` or `variable`, and `$env` a name the workspace declares, when its names are
 * known.
 */
function isScriptRef(ctx: CompileContext, root: string, names: readonly string[]): boolean {
  const [head] = names
  if (head === undefined) return false
  if (root === 'env') return !ctx.envNames || ctx.envNames.has(head)
  if (names.length < 2) return false
  return (
    ctx.declsByKey.has(head) ||
    ctx.declsByIdent.has(head) ||
    head === 'loop' ||
    head === 'parallel' ||
    head === 'variable'
  )
}

/**
 * `W_CODE_FILE_REF_SYNTAX` on each `$ref.key.path` and `$env.NAME` in a Python or shell file:
 * only JavaScript files are rewritten, so these reach the run as text and break the code. The
 * hint names the form those files take, the stored `<key.path>` tag or `{{NAME}}`, which the run
 * resolves with the language's own quoting.
 */
function reportScriptRefSyntax(
  ctx: CompileContext,
  path: string,
  text: string,
  language: Exclude<CodeFileLanguage, 'javascript'>,
  blockKey: BlockKey
): void {
  const label = SCRIPT_LANGUAGE_LABEL[language]
  for (const match of text.matchAll(SCRIPT_REF)) {
    const [written, root, members] = match
    const names = members.slice(1).split('.')
    if (!isScriptRef(ctx, root, names)) continue
    const form = root === 'env' ? `{{${names[0]}}}` : `<${names.join('.')}>`
    ctx.reporter.report(
      'W_CODE_FILE_REF_SYNTAX',
      `${written} is the JavaScript code file form; a ${label} file is saved as written, so the run reads it as text and the code breaks.`,
      { file: path, start: match.index, end: match.index + written.length },
      { hint: `${label} files are saved as written: write ${form}.`, blockKey }
    )
  }
}

/** The name inside a `{{NAME}}` env token a run substitutes; other `{{…}}` text is left alone. */
const ENV_TOKEN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The `<key.path>` references a code file writes as text, found by the runtime's own scanner (a
 * JavaScript string, a Python or shell line): the run resolves each one, so compile checks them as
 * it checks a `$ref` chain. A token with no path (`<b>` in HTML text) is no reference.
 */
function referenceTags(text: string): CodeFileRef[] {
  const tags: CodeFileRef[] = []
  for (const token of findWorkflowReferenceTokens(text)) {
    if (token.kind === 'environment') {
      const name = token.value.slice(2, -2).trim()
      if (ENV_TOKEN_NAME.test(name)) {
        tags.push({ kind: 'env', name, start: token.start, end: token.end })
      }
      continue
    }
    if (token.kind !== 'workflow') continue
    const segments = parseStoredPath(token.value.slice(1, -1))
    if (!segments || segments.length < 2) continue
    tags.push({ kind: 'ref', segments, start: token.start, end: token.end, tag: true })
  }
  return tags
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

/** `W_LITERAL_SECRET` on a field holding a literal secret, written or kept stored. */
function reportLiteralSecret(
  ctx: CompileContext,
  blockKey: BlockKey,
  entry: Pick<WrittenParam, 'property' | 'param'>,
  field: Pick<CatalogSubBlock, 'password' | 'resourceKind'>
): void {
  const { message, hint } = literalSecretFinding(entry.param, field)
  ctx.reporter.report('W_LITERAL_SECRET', message, rangeOf(ctx, entry.property), {
    hint,
    blockKey,
    param: entry.param,
  })
}

/** The site for one field: variables-input fields read bare `vars.k` as the variable itself. */
function fieldSite(site: ValueSite, sub: CatalogSubBlock | undefined): ValueSite {
  return structuredCodec(sub)?.varNodes ? { ...site, varNodes: true } : site
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
    if (outputs.has(key) || EDGE_METHODS.has(key)) {
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
        {
          hint:
            rows && rows.length > 0
              ? `Branches: ${rows.map((candidate) => candidate.key).join(', ')}.`
              : 'Write the branch in params; meta.branches only annotates written branches.',
          blockKey: site.decl.key,
        }
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
   * Params an error already explains the absence of, so `W_REQUIRED_MISSING` stays quiet for them:
   * one an `E_UNKNOWN_PARAM` did-you-mean names (the misspelling is the missing value), and one
   * written with a value that failed to compile.
   */
  explained: Set<string>
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
  state: Pick<BlockState, 'decl' | 'params' | 'modes' | 'unset'>,
  members: ReadonlyArray<{ id: SubBlockId; password?: boolean }>,
  property: ObjectProperty,
  field: CatalogField | null
): void {
  const { decl, params, modes } = state
  const stored = ctx.stored ? getOwn(ctx.stored.blocks, decl.key) : undefined
  const name = field?.name ?? members[0]?.id ?? ''
  const type =
    decl.builder.kind === 'container'
      ? decl.builder.container
      : decl.builder.kind === 'unknown'
        ? null
        : decl.builder.type
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
    if (param?.kind === 'value' && holdsSecret(member, param.value)) {
      reportLiteralSecret(ctx, decl.key, { property, param: name }, member)
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
  const codec = structuredCodec(target)
  if (codec && checked) {
    value = codec.compileLiteral(value, { ctx, node: property.value, blockKey: decl.key })
  }
  setOwn(params, target.id, { kind: 'value', value })
  state.written.push({ property, param: field.name, target: target.id, checked, value })
}

/** What a regular block's builder and catalog entry fix before its params compile. */
interface BlockShape {
  builder: Extract<ResolvedBuilder, { kind: 'catalog' | 'generic' }>
  catalogBlock: CatalogBlock | undefined
  index: FieldIndex | null
  /** Param ids the builder sets itself: its operation and fixed fields. */
  pinned: Set<string>
  branchField: CatalogBlock['graph']['branches']
  /** Condition branches written as top-level params (`branchesAtTopLevel`). */
  conditionForm: boolean
}

/** Params written in the params object, with the branches and response form they select. */
interface WrittenParams {
  branches: CanonicalBranches | undefined
  /** Top-level condition branch entries, compiled into rows once every param is read. */
  branchEntries: Array<[string, ObjectProperty]>
  responseBody: boolean
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
    explained: new Set(),
    unset: new Set(),
    pendingFile: null,
  }
  const { params, modes } = state
  const pinned = pinParams(builder, params)
  const catalogBlock = builder.block
  const branchField = catalogBlock?.graph.branches
  const shape: BlockShape = {
    builder,
    catalogBlock,
    index: catalogBlock ? buildFieldIndex(catalogBlock, triggerMode, pinned) : null,
    pinned,
    branchField,
    conditionForm: branchesAtTopLevel(branchField?.kind, builder.kind === 'catalog'),
  }

  if (paramsNode && paramsNode.type !== 'ObjectExpression') {
    unsupported(
      ctx,
      paramsNode,
      'Params are an object literal.',
      'Write { field: value }.',
      decl.key
    )
  }
  const written = compileWrittenParams(
    ctx,
    state,
    shape,
    paramsNode?.type === 'ObjectExpression' ? paramsNode : undefined
  )
  if (written.responseBody) setOwn(params, 'dataMode', { kind: 'value', value: 'json' })
  const branches = compileBlockBranches(ctx, state, shape, written)
  const codeFile = resolveCodeFile(ctx, state, catalogBlock)
  for (const field of shape.index?.fields.values() ?? []) {
    if (isModalPair(field) && !Object.hasOwn(modes, field.param))
      setOwn(modes, field.param, 'basic')
  }
  compileMetaParams(ctx, state, shape)
  const fromSource = new Set(Object.keys(params))
  const defaulted = fillEditorDefaults(state, shape)
  if (shape.index) checkFields(ctx, shape.index, state)
  if (builder.type === SCHEDULE_BLOCK_TYPE) checkScheduleTimezone(ctx, shape.index, state)

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

/** Sets the params a catalog builder pins (its operation and fixed fields) and returns their ids. */
function pinParams(
  builder: BlockShape['builder'],
  params: Record<SubBlockId, CanonicalParam>
): Set<string> {
  const pinned = new Set<string>()
  if (builder.kind !== 'catalog') return pinned
  for (const [id, value] of builderPins(builder.builder)) {
    pinned.add(id)
    setOwn(params, id, { kind: 'value', value })
  }
  return pinned
}

/** Compiles each property of the params object into a param, a branch, or a response field. */
function compileWrittenParams(
  ctx: CompileContext,
  state: BlockState,
  shape: BlockShape,
  paramsObject: ObjectExpression | undefined
): WrittenParams {
  const { decl, site, params } = state
  const { builder, catalogBlock, index, pinned, branchField, conditionForm } = shape
  const written: WrittenParams = {
    branches: branchField ? { kind: branchField.kind, rows: null } : undefined,
    branchEntries: [],
    responseBody: false,
  }
  if (!paramsObject) return written
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
  written.responseBody =
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
      written.branches = {
        kind: branchField.kind,
        rows:
          property.value.properties.length === 0
            ? null
            : compileBranchRows(ctx, rows, branchField.kind, catalogBlock, site),
      }
      continue
    }
    if (written.responseBody) {
      compileResponseParam(ctx, site, params, key, property)
      const formParam = RESPONSE_BODY_KEYS.some((formKey) => formKey === key)
        ? getOwn(params, key === 'body' ? 'data' : key)
        : undefined
      if (formParam?.kind === 'value' && holdsSecret(undefined, formParam.value)) {
        reportLiteralSecret(ctx, decl.key, { property, param: key }, {})
      }
      continue
    }
    if (conditionForm && !field && !pinned.has(key)) {
      written.branchEntries.push([key, property])
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
      compileUncataloguedParam(ctx, state, key, property)
      continue
    }
    if (!field) {
      const alias = index.memberAliases.get(key)
      const near = alias ?? closest(key, index.fields.keys())
      if (near !== null) state.explained.add(near)
      ctx.reporter.report(
        'E_UNKNOWN_PARAM',
        `${catalogBlock?.name ?? decl.key} has no param ${key}.`,
        rangeOf(ctx, property),
        {
          hint: alias
            ? `Write it as ${alias}; the value kind picks the basic or advanced field.`
            : (BLOCK_META_KEYS as readonly string[]).includes(key)
              ? `${key} is block meta, not a param: pass it in ${
                  builder.kind === 'generic'
                    ? `block()'s fourth argument, block('type', 'Name', {…}, { ${key}: … }).`
                    : `the builder's third argument, ('Name', {…}, { ${key}: … }).`
                }`
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
    const reported = ctx.reporter.diagnostics.length
    compileField(ctx, state, field, property)
    if (ctx.reporter.diagnostics.slice(reported).some((d) => d.severity === 'error')) {
      state.explained.add(field.name)
    }
  }
  return written
}

/** A param of a block type the catalog does not hold: written by its id, unchecked. */
function compileUncataloguedParam(
  ctx: CompileContext,
  state: BlockState,
  key: string,
  property: ObjectProperty
): void {
  const compiled = compileValue(ctx, property.value, state.site)
  if (!compiled || compiled.kind === 'absent' || compiled.kind === 'todo') return
  if (compiled.kind === 'stored') {
    keepStored(ctx, state, [{ id: key }], property, null)
    return
  }
  if (compiled.kind === 'codeFile') {
    unsupported(
      ctx,
      property.value,
      'codeFile() needs a catalog block type.',
      'Write the code inline.',
      state.decl.key
    )
    return
  }
  setOwn(state.params, key, { kind: 'value', value: compiled.value })
}

/** The block's branches: top-level condition entries become rows, then meta branch fields apply. */
function compileBlockBranches(
  ctx: CompileContext,
  state: BlockState,
  shape: BlockShape,
  written: WrittenParams
): CanonicalBranches | undefined {
  let branches = written.branches
  if (shape.conditionForm && shape.branchField) {
    branches = {
      kind: 'condition',
      rows:
        written.branchEntries.length === 0
          ? null
          : compileBranchRows(
              ctx,
              written.branchEntries,
              'condition',
              shape.catalogBlock,
              state.site
            ),
    }
  }
  if (branches) {
    applyBranchMeta(ctx, branches.rows, state.meta.branches, state.site)
  } else if (state.meta.branches[0]) {
    unsupported(
      ctx,
      state.meta.branches[0][1],
      'This block has no branches.',
      'Remove branches from the meta.',
      state.decl.key
    )
  }
  return branches
}

/** Reads a pending `codeFile()` in the block's language into its param; returns the file's path. */
function resolveCodeFile(
  ctx: CompileContext,
  state: BlockState,
  catalogBlock: CatalogBlock | undefined
): string | undefined {
  if (!state.pendingFile) return undefined
  const languageParam = state.params.language
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
  const read = readCodeFile(ctx, state.pendingFile.compiled, language, state.decl)
  if (!read) return undefined
  setOwn(state.params, state.pendingFile.target, { kind: 'value', value: read.code })
  return read.path
}

/** The stored params `meta.extra` carries; a regular block has no `subflowData`. */
function compileMetaParams(ctx: CompileContext, state: BlockState, shape: BlockShape): void {
  const { pinned, index, branchField } = shape
  const pinnedValues: Record<string, unknown> = {}
  for (const id of pinned) {
    const param = getOwn(state.params, id)
    setOwn(pinnedValues, id, param?.kind === 'value' ? param.value : undefined)
  }
  compileExtraParams(
    ctx,
    state.meta.extra,
    state,
    (id) => {
      if (pinned.has(id) || id === branchField?.subBlockId) return true
      const declarations = index?.declarations.get(id)
      return declarations !== undefined && typedForBuilder(declarations, pinnedValues)
    },
    (id, property) =>
      keepStored(ctx, state, index?.declarations.get(id) ?? [{ id }], property, null)
  )
  if (state.meta.subflowData) {
    unsupported(
      ctx,
      state.meta.subflowData.node,
      'Only a loop or parallel has subflowData.',
      'Remove subflowData; apply keeps the stored block data.',
      state.decl.key
    )
  }
}

/** Fills each param source leaves out with its editor default, as canvas creation does. */
function fillEditorDefaults(state: BlockState, shape: BlockShape): SubBlockId[] {
  const defaulted: SubBlockId[] = []
  if (!shape.catalogBlock) return defaulted
  for (const [id, value] of editorDefaults(shape.catalogBlock)) {
    if (Object.hasOwn(state.params, id) || state.unset.has(id) || shape.pinned.has(id)) continue
    if (id === shape.branchField?.subBlockId) continue
    setOwn(state.params, id, { kind: 'value', value })
    defaulted.push(id)
  }
  return defaulted
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
    const kept = getOwn(stored.params, id)
    // Judged with the stored value in place: the printer left the field out because it is
    // inactive as stored, and the default can make it active (a standalone advanced field runs
    // once non-empty, so a stored '' choice would turn into the default).
    const storedValue =
      kept === undefined ? undefined : kept.kind === 'value' ? kept.value : kept.tools
    if (!isInactive(id, withStoredValue(ctx.catalog, inputs, id, storedValue))) continue
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
 * viewer's own, so source never gets one by default (`I_SCHEDULE_UTC`). Silent when the schedule
 * type hides `timezone` (every few minutes, hourly), where checkFields warns against setting it.
 */
function checkScheduleTimezone(
  ctx: CompileContext,
  index: FieldIndex | null,
  state: BlockState
): void {
  const { decl, params } = state
  if (ctx.stored && getOwn(ctx.stored.blocks, decl.key)) return
  const values = storedValues(params)
  const field = index ? declarationFor(index, 'timezone', paramLookup(values)) : undefined
  if (field && !isVisible(field, values)) return
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

/** How many option ids a hint lists before it stops. */
const LISTED_OPTIONS = 12

function listOptions(ids: readonly string[]): string {
  const shown = ids.slice(0, LISTED_OPTIONS).join(', ')
  return ids.length > LISTED_OPTIONS ? `${shown}, and ${ids.length - LISTED_OPTIONS} more` : shown
}

/**
 * The first literal a field's value holds that none of its static options names: a dropdown's
 * value (each element of a multi-select), or the `model` combobox's. A reference, an env token or
 * an empty value is never checked; nor is any other combobox, which takes free text.
 */
function unknownOption(
  sub: CatalogSubBlock,
  value: Value
): { value: string; ids: string[] } | null {
  const options = sub.options
  if (!Array.isArray(options) || options.length === 0) return null
  const isModel = sub.id === 'model' && sub.type === 'combobox'
  if (sub.type !== 'dropdown' && !isModel) return null
  const ids = options.map((option) => option.id)
  const known = new Set(ids)
  const items = Array.isArray(value) ? value : [value]
  for (const item of items) {
    if (typeof item !== 'string' && typeof item !== 'number') continue
    const text = String(item)
    if (text === '' || known.has(text) || findWorkflowReferenceTokens(text).length > 0) continue
    return { value: text, ids }
  }
  return null
}

/**
 * A written option value the field does not offer. `operation` picks the tool that runs, so an
 * unknown one is `E_UNKNOWN_OPERATION`, unless the stored block already holds it (a retired
 * operation keeps round-tripping, as a warning). An unknown `model` is `W_UNKNOWN_MODEL` (custom
 * and self-hosted models are free text); any other dropdown value is `W_UNKNOWN_OPTION`.
 */
function checkOption(
  ctx: CompileContext,
  state: BlockState,
  sub: CatalogSubBlock,
  entry: WrittenParam
): void {
  const unknown = unknownOption(sub, entry.value)
  if (!unknown) return
  const { decl } = state
  const at = rangeOf(ctx, entry.property)
  const near = didYouMean(unknown.value, unknown.ids)
  const listed = `${near ? `${near} ` : ''}Options: ${listOptions(unknown.ids)}.`
  if (sub.id === 'operation') {
    const stored = ctx.stored ? getOwn(ctx.stored.blocks, decl.key) : undefined
    const storedOperation = stored ? getOwn(stored.params, 'operation') : undefined
    const kept =
      stored?.type === catalogBlockOf(decl)?.type &&
      storedOperation?.kind === 'value' &&
      storedOperation.value === unknown.value
    ctx.reporter.report(
      kept ? 'W_UNKNOWN_OPTION' : 'E_UNKNOWN_OPERATION',
      `${catalogBlockOf(decl)?.name ?? decl.key} has no operation ${unknown.value}.`,
      at,
      { hint: listed, blockKey: decl.key, param: entry.param }
    )
    return
  }
  if (sub.id === 'model' && sub.type === 'combobox') {
    ctx.reporter.report(
      'W_UNKNOWN_MODEL',
      `${unknown.value} is not a model the catalog lists; it is kept as written.`,
      at,
      {
        hint:
          near ??
          'Use a model id from .sim/sdk/models.d.ts, or keep it for a custom or self-hosted model.',
        blockKey: decl.key,
        param: entry.param,
      }
    )
    return
  }
  ctx.reporter.report(
    'W_UNKNOWN_OPTION',
    `${entry.param} has no option ${unknown.value}; it is kept as written.`,
    at,
    { hint: listed, blockKey: decl.key, param: entry.param }
  )
}

/**
 * The traits a literal-secret finding reads for a written param: the subBlock the value landed in,
 * marked a credential when it is the manual member of a pair whose picker takes a saved credential
 * (`credential: 'xoxb-…'` lands in `manualCredential`, but the fix is `credential('<key>')`).
 */
function secretFieldOf(
  index: FieldIndex,
  param: string,
  sub: CatalogSubBlock
): Pick<CatalogSubBlock, 'password' | 'resourceKind'> {
  const field = index.fields.get(param) ?? index.aliased.get(param)
  const credentialPair =
    field?.kind === 'pair' && field.members.some((member) => member.resourceKind === 'credential')
  return credentialPair ? { password: sub.password, resourceKind: 'credential' } : sub
}

/** How far a value may sit off a slider step and still count as on it (floating-point error). */
const STEP_TOLERANCE = 1e-9

/**
 * Why a literal number falls outside a slider's catalog range (`min`, `max`, `step`, `integer`),
 * with a hint naming the accepted values, or `null` when it fits or the field is not a slider.
 */
function sliderRangeProblem(
  sub: CatalogSubBlock,
  value: Value
): { problem: string; hint: string } | null {
  if (sub.type !== 'slider' || typeof value !== 'number' || !Number.isFinite(value)) return null
  const { min, max, step, integer } = sub
  const range =
    min !== undefined && max !== undefined
      ? `from ${min} to ${max}`
      : min !== undefined
        ? `of at least ${min}`
        : max !== undefined
          ? `of at most ${max}`
          : null
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
    return {
      problem: `is ${value}, outside its range; it is kept as written.`,
      hint: `Write a value ${range ?? ''}.`,
    }
  }
  if (integer && !Number.isInteger(value)) {
    return {
      problem: `is ${value}, but takes whole numbers only; it is kept as written.`,
      hint: `Write a whole number${range ? ` ${range}` : ''}.`,
    }
  }
  if (step !== undefined && step > 0) {
    const steps = (value - (min ?? 0)) / step
    if (Math.abs(steps - Math.round(steps)) > STEP_TOLERANCE) {
      return {
        problem: `is ${value}, between steps of ${step}; it is kept as written.`,
        hint: `Write a multiple of ${step}${min ? ` from ${min}` : ''}${range ? `, ${range}` : ''}.`,
      }
    }
  }
  return null
}

/** The fix for `W_VALUE_KIND`: the literal form the field's value kind takes. */
function valueKindHint(sub: CatalogSubBlock): string {
  const call = sub.resourceKind ? getOwn(SDK_RESOURCE_CALLS, sub.resourceKind) : undefined
  switch (sub.valueKind) {
    case 'resource':
      return call ? `Write ${call}('<key>').` : 'Write the resource by its key.'
    case 'string':
    case 'code':
    case 'picked':
      return 'Write text: a string, a t`` template or a reference.'
    case 'number':
      return "Write a number literal (3, not '3'), or a reference."
    case 'boolean':
      return 'Write true or false, or a reference.'
    case 'array':
      return 'Write an array literal [ ... ], or a reference.'
    case 'object':
      return 'Write an object literal { ... }, or a reference.'
    default:
      return 'Write a value of that kind, or a reference.'
  }
}

/**
 * `W_FIELD_NOT_APPLICABLE`: a hidden field never runs, and source holds only what runs, so an
 * apply restores the stored value over it (preserved state) and the printed source drops it.
 */
function notApplicableMessage(param: string, reason: string | null): string {
  const hidden = reason ? `hidden (${reason})` : "hidden under the block's current values"
  return `${param} is ${hidden}, so it never runs: an apply does not save it over the stored value, and the source it writes back drops this line.`
}

/** Catalog warnings: visibility, required fields, value kinds, slider ranges. */
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
        notApplicableMessage(entry.param, hiddenReason(sub, values)),
        rangeOf(ctx, entry.property),
        {
          hint: `Remove ${entry.param}, or change the values that hide it so it runs.`,
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
    if (holdsSecret(sub, entry.value)) {
      reportLiteralSecret(ctx, decl.key, entry, secretFieldOf(index, entry.param, sub))
    }
    if (entry.checked) checkOption(ctx, state, sub, entry)
    if (entry.checked && !valueKindMatches(sub, entry.value)) {
      ctx.reporter.report(
        'W_VALUE_KIND',
        `${entry.param} expects a ${sub.valueKind} value; the value is kept as written.`,
        rangeOf(ctx, entry.property),
        { hint: valueKindHint(sub), blockKey: decl.key, param: entry.param }
      )
    }
    const outOfRange = entry.checked ? sliderRangeProblem(sub, entry.value) : null
    if (outOfRange !== null) {
      ctx.reporter.report(
        'W_OUT_OF_RANGE',
        `${entry.param} ${outOfRange.problem}`,
        rangeOf(ctx, entry.property),
        {
          hint: outOfRange.hint,
          blockKey: decl.key,
          param: entry.param,
        }
      )
    }
  }
  for (const field of missingRequiredFields(index, values, (id) => Object.hasOwn(params, id))) {
    if (state.explained.has(field.name)) continue
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
 * The config object of a container call, compiled against its form: each key's value, checked for
 * the kind its spec field holds, keyed by that field. A key the form does not take is
 * `E_UNKNOWN_PARAM`.
 */
function compileConfig<S>(
  ctx: CompileContext,
  site: ValueSite,
  container: 'loop' | 'parallel',
  form: ContainerForm<S>,
  configNode: ObjectExpression | undefined
): CompiledConfig<S> {
  const { decl } = site
  const fields = new Map<ConfigField<S>, Value>()
  const written = new Map<ConfigField<S>, ObjectProperty>()
  if (!configNode) return { fields, written }
  for (const [key, property] of objectEntries(ctx, configNode)) {
    const entry = getOwn(form, key)
    if (!entry) {
      ctx.reporter.report(
        'E_UNKNOWN_PARAM',
        `This ${container} has no config ${key}.`,
        rangeOf(ctx, property),
        { hint: didYouMean(key, Object.keys(form)), blockKey: decl.key }
      )
      continue
    }
    written.set(entry.field, property)
    const node = property.value
    const field = String(entry.field)
    if (entry.kind === 'number') {
      const value = numberLiteral(node)
      if (value === null) {
        unsupported(ctx, node, `${field} is a number.`, `Write ${field}: 3.`, decl.key)
        continue
      }
      checkSubflowCount(ctx, decl, key, value, node)
      fields.set(entry.field, value)
      continue
    }
    const compiled = compileValue(ctx, node, site)
    if (compiled?.kind === 'stored' || compiled?.kind === 'codeFile') {
      unsupported(
        ctx,
        node,
        `${compiled.kind === 'stored' ? 'stored()' : 'codeFile()'} is not a ${container} config value.`,
        entry.kind === 'text'
          ? `Write ${key}: js\`...\`.`
          : `Write ${key} as a value or a reference.`,
        decl.key
      )
      continue
    }
    if (!compiled || compiled.kind !== 'value') continue
    if (entry.kind === 'text' && typeof compiled.value !== 'string') {
      unsupported(ctx, node, `${field} is text.`, 'Write js`...`.', decl.key)
      continue
    }
    fields.set(entry.field, compiled.value)
  }
  return { fields, written }
}

/** A container's compiled config values, and the property each written key came from. */
interface CompiledConfig<S> {
  fields: Map<ConfigField<S>, Value>
  written: Map<ConfigField<S>, ObjectProperty>
}

/**
 * `W_FIELD_NOT_APPLICABLE` on a written config key the container does not read beside the rest of
 * its config (`count` on a do-while that has a condition): the executor ignores it, so writing it
 * changes nothing.
 */
function reportUnreadConfig<S>(
  ctx: CompileContext,
  decl: BlockDecl,
  form: ContainerForm<S>,
  written: ReadonlyMap<ConfigField<S>, ObjectProperty>,
  spec: S
): void {
  for (const [key, entry] of Object.entries(form)) {
    const property = written.get(entry.field)
    if (!property || !entry.unread || !entry.printedWhen || entry.printedWhen(spec)) continue
    ctx.reporter.report(
      'W_FIELD_NOT_APPLICABLE',
      `${key} is not read: ${entry.unread.reason}.`,
      rangeOf(ctx, property),
      { hint: entry.unread.hint, blockKey: decl.key }
    )
  }
}

function numberField(value: Value | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function textField(value: Value | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function jsonField(value: Value | undefined): Json | undefined {
  return isJson(value) ? value : undefined
}

/**
 * A while or do-while condition checked as the run evaluates it (`LoopOrchestrator`
 * `evaluateWhileCondition`): each reference is replaced by its value and the text runs as
 * `return Boolean(<condition>)`, outside every block.
 * - `W_LOOP_CONDITION_SYNTAX` when that is not valid JavaScript, which fails the run: references
 *   stand in as `(0)`, a value that member access and calls can follow, so only the text the
 *   author wrote around them is judged.
 * - `W_REF_OUT_OF_SCOPE` for the loop's own iteration field read by its name (`<w.index>`): the
 *   condition is evaluated outside the loop's body, where a named loop outputs only its results,
 *   so the run fails; only the bare `<loop.index>` reads the iteration there.
 */
function checkLoopCondition(
  ctx: CompileContext,
  decl: BlockDecl,
  text: string,
  property: ObjectProperty
): void {
  if (text.trim() === '') return
  const at = rangeOf(ctx, property.value)
  const selfReads = new Set<string>()
  const ownName = normalizeWorkflowBlockName(decl.name)
  const runnable = text.replace(REFERENCE_CANDIDATE, (match: string, inner: string) => {
    if (!isLikelyWorkflowReferenceSegment(match)) return match
    const segments = parseStoredPath(inner)
    const [head, field] = segments ?? []
    if (
      head?.kind === 'name' &&
      normalizeWorkflowBlockName(head.name) === ownName &&
      field?.kind === 'name' &&
      LOOP_PROPERTIES.includes(field.name)
    ) {
      selfReads.add(field.name)
    }
    return '(0)'
  })
  for (const field of selfReads) {
    ctx.reporter.report(
      'W_REF_OUT_OF_SCOPE',
      `${decl.name}'s condition reads its own ${field} by the loop's name. The run evaluates the condition outside the loop's body, where the loop outputs only results, so the run fails.`,
      at,
      {
        hint: `Write <loop.${field}>: the bare loop prefix reads the iteration the condition is evaluated for.`,
        blockKey: decl.key,
      }
    )
  }
  let failure: unknown = null
  try {
    const file = parse(`return Boolean(${runnable})`, {
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      errorRecovery: true,
    })
    failure = file.errors?.[0] ?? null
  } catch (error) {
    failure = error
  }
  if (failure === null) return
  ctx.reporter.report(
    'W_LOOP_CONDITION_SYNTAX',
    `${decl.name}'s condition is not a JavaScript expression (${babelMessage(babelErrorShape(failure))}), so the run fails when it evaluates it.`,
    at,
    {
      hint: "Write one JavaScript expression the loop repeats while it is true, e.g. condition: '<loop.index> < 3'.",
      blockKey: decl.key,
    }
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
  const config = configNode?.type === 'ObjectExpression' ? configNode : undefined
  if (configNode && !config) {
    unsupported(
      ctx,
      configNode,
      'The config is an object literal.',
      'Write { count: 3 }.',
      decl.key
    )
  }

  let subflow: LoopSpec | ParallelSpec
  if (builder.container === 'loop') {
    const form = loopForm(builder.method)
    const { fields, written } = compileConfig(ctx, site, 'loop', form, config)
    const iterations = numberField(fields.get('iterations'))
    const forEachItems = jsonField(fields.get('forEachItems'))
    const whileCondition = textField(fields.get('whileCondition'))
    const doWhileCondition = textField(fields.get('doWhileCondition'))
    const loop: LoopSpec = {
      kind: 'loop',
      loopType: builder.method,
      iterations: iterations ?? DEFAULT_LOOP_ITERATIONS,
      ...(forEachItems !== undefined && { forEachItems }),
      ...(whileCondition !== undefined && { whileCondition }),
      ...(doWhileCondition !== undefined && { doWhileCondition }),
    }
    reportUnreadConfig(ctx, decl, form, written, loop)
    for (const field of ['whileCondition', 'doWhileCondition'] as const) {
      const text = loop[field]
      const property = written.get(field)
      if (text !== undefined && property) checkLoopCondition(ctx, decl, text, property)
    }
    subflow = loop
  } else {
    const { fields } = compileConfig(ctx, site, 'parallel', parallelForm(builder.method), config)
    const count = numberField(fields.get('count'))
    const distribution = jsonField(fields.get('distribution'))
    const batchSize = numberField(fields.get('batchSize'))
    subflow = {
      kind: 'parallel',
      ...(builder.method !== null && { parallelType: builder.method }),
      ...(count !== undefined && { count }),
      ...(distribution !== undefined && { distribution }),
      ...(batchSize !== undefined && { batchSize }),
    }
  }

  const params: Record<SubBlockId, CanonicalParam> = {}
  const state = { decl, site, params, modes: {}, unset: new Set<SubBlockId>() }
  compileExtraParams(
    ctx,
    meta.extra,
    state,
    () => false,
    (id, property) => keepStored(ctx, state, [{ id }], property, null)
  )

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
  if (decl.builder.kind !== 'container') {
    checkLegacyType(ctx, decl)
    checkUnplaceableType(ctx, decl)
  }
  return decl.builder.kind === 'container'
    ? compileContainer(ctx, decl)
    : compileRegularBlock(ctx, decl)
}

/** Whether the lock of an unread stored workflow binds `decl`, by key or by ident. */
function lockBinds(ctx: CompileContext, decl: BlockDecl): boolean {
  const lock = ctx.storedUnread
  return (
    lock !== undefined &&
    (Object.hasOwn(lock.blocks, decl.key) ||
      (decl.ident !== null && ctx.storedUnreadIdents.has(decl.ident)))
  )
}

/**
 * A new block of a type an apply cannot place: `W_UNKNOWN_BLOCK_TYPE` for a `block()` of a type the
 * catalog does not hold, `W_TYPE_NOT_ADDABLE` for one it keeps only for blocks already using it
 * (`addable: false`). A block the stored workflow may continue stays quiet: one the lock binds,
 * or any block of a type the stored workflow holds, since rename inference may bind it to one.
 */
function checkUnplaceableType(ctx: CompileContext, decl: BlockDecl): void {
  const { builder } = decl
  if (builder.kind !== 'generic' && builder.kind !== 'catalog') return
  const notAddable = builder.block?.addable === false
  const uncatalogued = builder.kind === 'generic' && !builder.block
  if (!(notAddable || uncatalogued) || ctx.storedTypes.has(builder.type) || lockBinds(ctx, decl)) {
    return
  }
  if (notAddable) {
    ctx.reporter.report(
      'W_TYPE_NOT_ADDABLE',
      `${builder.type} can stay where a workflow already uses it, but an apply cannot add a new block of it.`,
      rangeOf(ctx, decl.call),
      { hint: 'Use a block type this workspace offers.', blockKey: decl.key }
    )
    return
  }
  ctx.reporter.report(
    'W_UNKNOWN_BLOCK_TYPE',
    `${builder.type} is not a block type this workspace offers, so an apply cannot add the block.`,
    rangeOf(ctx, decl.call),
    {
      hint: () =>
        didYouMean(builder.type, Object.keys(ctx.catalog.blocks)) ??
        'Use a block type from the catalog, or a builder such as api() or fn().',
      blockKey: decl.key,
    }
  )
}

/**
 * `W_LEGACY_BLOCK_TYPE` for a new block of a legacy or deprecated type, naming its replacement and
 * that type's builders. A block the stored workflow already holds under that type stays quiet; an
 * offline check, which has only the lock, stays quiet on a block the lock binds by key or ident,
 * as the server does for the stored block it continues.
 */
function checkLegacyType(ctx: CompileContext, decl: BlockDecl): void {
  const block = catalogBlockOf(decl)
  const sunset = block?.lifecycle?.sunset
  if (!block || !sunset) return
  const stored = ctx.stored ? getOwn(ctx.stored.blocks, decl.key) : undefined
  if (stored?.type === block.type || lockBinds(ctx, decl)) return
  const replacement = sunset.replacedBy
  const namespaces = replacement
    ? [
        ...new Set(
          catalogBuildersOfType(ctx.catalog, replacement).map(([path]) => {
            const [head] = path.split('.')
            return path.includes('.') ? `${head}.*` : head
          })
        ),
      ]
    : []
  ctx.reporter.report(
    'W_LEGACY_BLOCK_TYPE',
    `${block.type} is a ${sunset.status} block type${replacement ? `; ${replacement} replaces it` : ''}.`,
    rangeOf(ctx, decl.call),
    {
      hint: replacement
        ? `Use ${namespaces.length > 0 ? namespaces.join(' or ') : `block('${replacement}', …)`} instead.`
        : 'Use a current block type instead.',
      blockKey: decl.key,
    }
  )
}
