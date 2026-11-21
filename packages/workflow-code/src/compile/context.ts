import type {
  ArrowFunctionExpression,
  CallExpression,
  ExpressionStatement,
  Identifier,
  Node,
} from '@babel/types'
import { encodeAnchor } from '../anchors'
import type { BlockCatalog, CatalogBlock, CatalogBuilder } from '../catalog/types'
import { catalogBuilderPaths } from '../catalog/view'
import type { CodeFileRef } from '../code-files'
import type { RefSegment } from '../code-files/ref-path'
import type { SourceSpan } from '../diagnostics/frame'
import type { JsonTree } from '../json-fields'
import type { WorkflowLockV1 } from '../lock'
import type {
  Anchor,
  AnchorKey,
  BlockKey,
  CanonicalParam,
  CanonicalVariable,
  CanonicalWorkflow,
  CanonicalWorkflowMeta,
  LoopType,
  ParallelType,
  SubBlockId,
  VarKey,
} from '../model'
import { isSdkCoreExport, SDK_MODULE } from '../sdk'
import type { AddCommentItem, CommentCollector } from './comments'
import { didYouMean } from './hints'
import type { CompileLimits } from './parse'
import type { Range, Reporter } from './report'

/** The wiring methods on a block reference: `a.to(b)` and `a.onError(b)`. */
export const EDGE_METHODS: ReadonlySet<string> = new Set(['to', 'onError'])

/** How a block call was resolved against the SDK surface and the catalog. */
export type ResolvedBuilder =
  | {
      kind: 'catalog'
      path: string
      type: string
      builder: CatalogBuilder
      block: CatalogBlock | undefined
    }
  | { kind: 'generic'; type: string; block: CatalogBlock | undefined }
  | { kind: 'container'; container: 'loop'; method: LoopType }
  | {
      kind: 'container'
      container: 'parallel'
      /** `null` for the bare `parallel(...)` form, which leaves `parallelType` unset. */
      method: ParallelType | null
    }
  /**
   * `E_UNKNOWN_BUILDER` (or a non-literal `block()` type) was reported; the name still claims
   * its key.
   */
  | { kind: 'unknown' }

/** One block declaration collected in pass 1, before its values are compiled. */
export interface BlockDecl {
  key: BlockKey
  name: string
  /** The `const` identifier, or `null` for a bare statement or an arrow-expression body. */
  ident: string | null
  call: CallExpression
  /** The node the `block` anchor and span cover. */
  anchorNode: Node
  nameNode: Node
  /** The scope the declaration sits in. */
  scope: Scope
  /** The enclosing loop/parallel declaration. */
  parent: BlockDecl | null
  order: number
  builder: ResolvedBuilder
  /** A duplicate name: reported, never emitted. */
  duplicate: boolean
  /**
   * Set when `meta.key` keyed the block `${base}~n` (a legacy collision key). The plain `base`
   * key must be declared too; that is checked once every declaration is collected.
   */
  collisionBase?: { base: BlockKey; node: Node }
}

type Binding =
  | { kind: 'block'; decl: BlockDecl }
  | { kind: 'subflowScope'; container: BlockDecl }
  | { kind: 'sdk'; name: string }
  | { kind: 'vars' }

/** A lexical body scope: the workflow body, a loop/parallel body, or the module (imports). */
export interface Scope {
  parent: Scope | null
  bindings: Map<string, Binding>
  /** The loop/parallel whose body this is, or `null` for the workflow body and module scope. */
  container: BlockDecl | null
}

export interface WiringStatement {
  statement: ExpressionStatement
  scope: Scope
  /** The first wiring statement of the workflow body, for the `wiring` comment anchor. */
  firstWiring: boolean
  /** Registers the statement as a comment item once its edge anchor is known. */
  addItem: AddCommentItem
}

/** An edge implied by an arrow-expression body: `(p) => block(...)` means `p.to(block)`. */
interface ImpliedEdge {
  container: BlockDecl
  child: BlockDecl
  body: ArrowFunctionExpression
}

/** Code-file reads within one compile: each distinct file is read and parsed once. */
interface CodeFileBudget {
  /** Repo-relative path → stored code, or `null` when the file was rejected. */
  reads: Map<string, string | null>
  /** `codeFile()` references seen so far. */
  refs: number
  /** Bytes of the entry plus the distinct code files read so far. */
  bytes: number
  /**
   * The `$ref` chains and `$env` names of each distinct JavaScript file read, checked against the declared blocks
   * once every block is known (`checkCodeFileRefs`).
   */
  chains: Array<{ path: string; blockKey: BlockKey; refs: CodeFileRef[] }>
  /**
   * A file another block already read, by each later block that reads it too: its references are
   * checked for that block's iteration scope only, as every other check depends on the file alone.
   */
  sharedReads: Array<{ path: string; blockKey: BlockKey }>
}

/** The state one compile threads through every pass: inputs, the reporter and what it collected. */
export interface CompileContext {
  file: string
  reporter: Reporter
  catalog: BlockCatalog
  files: ReadonlyMap<string, string>
  limits: Required<CompileLimits>
  codeFiles: CodeFileBudget
  comments: CommentCollector
  decls: BlockDecl[]
  declsByKey: Map<BlockKey, BlockDecl>
  /** The first block declaration by its NFC-normalized key, for `E_LOOKALIKE_NAME`. */
  declsByLookalike: Map<string, BlockDecl>
  /** Every block declaration by ident, across scopes, for `E_OUT_OF_SCOPE`. */
  declsByIdent: Map<string, BlockDecl[]>
  variables: Map<VarKey, CanonicalVariable>
  wiring: WiringStatement[]
  implied: ImpliedEdge[]
  spans: Map<AnchorKey, SourceSpan>
  /** Where `workflow()` writes the name and the description: `CompileResult.metaSpans`. */
  metaSpans: Partial<Record<keyof CanonicalWorkflowMeta, SourceSpan>>
  /** `CompileInput.knownKeys`: the only keys a `meta.key` override may name. */
  knownKeys: ReadonlySet<BlockKey>
  /** `CompileInput.stored`: the stored workflow `stored()` reads its values from. */
  stored: CanonicalWorkflow | undefined
  /**
   * `CompileInput.storedUnread` when `stored` is absent: the lock of a stored workflow an offline
   * check continues without reading it.
   */
  storedUnread: WorkflowLockV1 | undefined
  /** The block types `stored` holds, read once so a per-block check stays constant time. */
  storedTypes: ReadonlySet<string>
  /** The idents `storedUnread` binds, read once so a per-block check stays constant time. */
  storedUnreadIdents: ReadonlySet<string>
  /** `CompileInput.envNames`: the env names a run resolves, when known. */
  envNames: ReadonlySet<string> | undefined
  /** `CompileInput.envDeclaredIn`: the file the env names are declared in, when there is one. */
  envDeclaredIn: string | undefined
  /** Every env name the source reads, whether or not `envNames` holds it. */
  envReferences: Set<string>
  /**
   * JSON code fields written as literals. Their text depends on the output types of the blocks
   * they reference (`json-fields.ts`), so it is written once every block is compiled.
   */
  jsonFields: JsonFieldEntry[]
  /**
   * References into blocks whose outputs a param declares (`responseFormat`, an input trigger's
   * `inputFormat`), checked once every block is compiled, since the format is JSON field text
   * written last (`checkDynamicOutputRefs`).
   */
  dynamicOutputRefs: DynamicOutputRef[]
  /** Literal tags whose head names no block, checked once renames are known (`checkUnresolvedTags`). */
  unresolvedTags: LiteralTag[]
  /** `x.error` references, checked once the edges are known (`checkErrorOutputRefs`). */
  errorOutputRefs: Array<Omit<DynamicOutputRef, 'segments'>>
  /**
   * Branch keys already refused with an error, by block key. Wiring and branch meta that name one
   * stay quiet instead of adding `E_UNKNOWN_BRANCH` for the same mistake.
   */
  refusedBranches: Map<BlockKey, Set<string>>
  /**
   * Names of consts refused for holding a value rather than a block, so a reference to one says to
   * write the value there instead of offering a did-you-mean.
   */
  valueConsts: Set<string>
}

/** A `<Name.path>` in literal text whose head is no declared block's key. */
export interface LiteralTag {
  token: string
  segments: RefSegment[]
  normalized: BlockKey
  at: Range
  blockKey: BlockKey
}

/** A reference path into a block whose outputs its `responseFormat` declares. */
interface DynamicOutputRef {
  at: Range
  target: BlockDecl
  segments: RefSegment[]
  blockKey: BlockKey
}

/** A JSON code field written as a literal, and where each bare reference in it was written. */
export interface JsonFieldEntry {
  params: Record<SubBlockId, CanonicalParam>
  id: SubBlockId
  tree: JsonTree
  refs: Array<{ token: string; range: Range; blockKey: BlockKey }>
}

/** Anything with Babel-style offsets. */
interface Located {
  start?: number | null
  end?: number | null
}

/** The range a node covers in the entry file. */
export function rangeOf(ctx: CompileContext, node: Located): Range {
  const start = node.start ?? 0
  return { file: ctx.file, start, end: node.end ?? start }
}

/**
 * Reports `E_UNSUPPORTED_SYNTAX` at `node`. Returns `null` so a step that gives up can
 * `return unsupported(...)`.
 */
export function unsupported(
  ctx: CompileContext,
  node: Located,
  message: string,
  hint?: string,
  blockKey?: BlockKey
): null {
  ctx.reporter.report('E_UNSUPPORTED_SYNTAX', message, rangeOf(ctx, node), { hint, blockKey })
  return null
}

/** Records an anchor's span the first time it is seen. */
export function recordSpan(ctx: CompileContext, anchor: Anchor, node: Located): AnchorKey {
  const key = encodeAnchor(anchor)
  if (!ctx.spans.has(key)) ctx.spans.set(key, ctx.reporter.span(rangeOf(ctx, node)))
  return key
}

/** The binding `name` resolves to from `scope`, innermost scope first, or `null`. */
export function lookup(scope: Scope, name: string): Binding | null {
  for (let current: Scope | null = scope; current; current = current.parent) {
    const binding = current.bindings.get(name)
    if (binding) return binding
  }
  return null
}

/** Every identifier visible from `scope`, innermost first, for did-you-mean. */
function visibleNames(scope: Scope): string[] {
  const names: string[] = []
  for (let current: Scope | null = scope; current; current = current.parent) {
    names.push(...current.bindings.keys())
  }
  return names
}

/**
 * Whether `name` is something a workflow file imports from the SDK: a core export (`loop`, `js`,
 * `env`) or a block namespace of the catalog (`slack`).
 */
export function isSdkImportable(ctx: CompileContext, name: string): boolean {
  return (
    isSdkCoreExport(name) ||
    catalogBuilderPaths(ctx.catalog).some((path) => path === name || path.startsWith(`${name}.`))
  )
}

/**
 * Reports `code` for an SDK export the file uses but does not import: the one finding that names
 * the fix, which the caller follows by compiling nothing that depends on it.
 */
export function reportNotImported(
  ctx: CompileContext,
  code: 'E_UNKNOWN_BUILDER' | 'E_UNKNOWN_IDENTIFIER',
  name: string,
  at: Located,
  blockKey?: BlockKey
): null {
  ctx.reporter.report(code, `${name} is not imported from '${SDK_MODULE}'.`, rangeOf(ctx, at), {
    hint: `Add ${name} to the import from '${SDK_MODULE}'.`,
    blockKey,
  })
  return null
}

/**
 * Reports an identifier `scope` does not bind: `E_OUT_OF_SCOPE` when a block inside another loop or
 * parallel holds the name, else `E_UNKNOWN_IDENTIFIER` with a did-you-mean over the visible names
 * (an SDK export not imported names the import, after any did-you-mean).
 * `at` is what the out-of-scope error covers (a whole member chain for a reference). Returns `null`.
 */
export function reportUnresolvedIdentifier(
  ctx: CompileContext,
  scope: Scope,
  identifier: Identifier,
  blockKey?: BlockKey,
  at: Located = identifier
): null {
  if (ctx.declsByIdent.get(identifier.name)?.length) {
    ctx.reporter.report(
      'E_OUT_OF_SCOPE',
      `${identifier.name} is declared inside another loop or parallel and is not visible here.`,
      rangeOf(ctx, at),
      {
        hint: 'Wire or reference the loop or parallel that holds it, or move the block into this scope.',
        blockKey,
      }
    )
    return null
  }
  if (!ctx.valueConsts.has(identifier.name) && isSdkImportable(ctx, identifier.name)) {
    // A read of `agent` beside a block named agent1 is a typo of the handle more often than a
    // missing import: the did-you-mean leads, and the import is the second clause.
    const near = didYouMean(identifier.name, visibleNames(scope))
    if (!near) {
      return reportNotImported(ctx, 'E_UNKNOWN_IDENTIFIER', identifier.name, identifier, blockKey)
    }
    ctx.reporter.report(
      'E_UNKNOWN_IDENTIFIER',
      `${identifier.name} is not defined.`,
      rangeOf(ctx, identifier),
      {
        hint: `${near} (${identifier.name} is also an SDK export, which needs adding to the import from '${SDK_MODULE}'.)`,
        blockKey,
      }
    )
    return null
  }
  ctx.reporter.report(
    'E_UNKNOWN_IDENTIFIER',
    `${identifier.name} is not defined.`,
    rangeOf(ctx, identifier),
    { hint: unresolvedHint(ctx, scope, identifier.name), blockKey }
  )
  return null
}

/** The fix for an identifier nothing binds. */
function unresolvedHint(ctx: CompileContext, scope: Scope, name: string): string | undefined {
  if (ctx.valueConsts.has(name)) {
    return `${name} is a const that holds a value, which a workflow file cannot name: write the value here.`
  }
  if (name === 'undefined') return 'Write null to store the param absent, or leave the param out.'
  if (name === 'NaN' || name === 'Infinity') {
    return 'A workflow stores JSON, which has no NaN or Infinity: write a finite number or a string.'
  }
  if (name === 'process') {
    return "Read an environment variable as env.NAME, with env imported from '@sim/workflow-sdk'."
  }
  return didYouMean(name, visibleNames(scope))
}

/** The enclosing containers of a declaration, innermost first (not the declaration itself). */
export function enclosingContainers(decl: BlockDecl): BlockDecl[] {
  const chain: BlockDecl[] = []
  for (let current = decl.parent; current; current = current.parent) chain.push(current)
  return chain
}

/** The catalog block a declaration builds; `undefined` for a container or an unknown builder. */
export function catalogBlockOf(decl: BlockDecl): CatalogBlock | undefined {
  switch (decl.builder.kind) {
    case 'catalog':
    case 'generic':
      return decl.builder.block
    default:
      return undefined
  }
}

/** Whether a declaration is a loop or a parallel, or `null` for any other block. */
export function containerKindOf(decl: BlockDecl): 'loop' | 'parallel' | null {
  return decl.builder.kind === 'container' ? decl.builder.container : null
}
