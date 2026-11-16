import type {
  ArrowFunctionExpression,
  CallExpression,
  ExpressionStatement,
  Node,
} from '@babel/types'
import { encodeAnchor } from '../anchors'
import type { CompileLimits } from '../api'
import type { BlockCatalog, CatalogBlock, CatalogBuilder } from '../catalog/types'
import type { SourceSpan } from '../diagnostics/frame'
import type { Anchor, AnchorKey, BlockKey, CanonicalVariable, VarKey } from '../model'
import type { AddCommentItem, CommentCollector } from './comments'
import type { Range, Reporter } from './report'

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
  | {
      kind: 'container'
      container: 'loop' | 'parallel'
      /** `null` for the bare `parallel(...)` form, which leaves `parallelType` unset. */
      method: string | null
    }
  /** `E_UNKNOWN_BUILDER` was reported; the name still claims its key. */
  | { kind: 'unknown' }

export interface BlockDecl {
  key: BlockKey
  name: string
  /** The `const` identifier, or `null` for a bare statement or an arrow-expression body. */
  binding: string | null
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
  /** The body scope, for containers. */
  body: Scope | null
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
  | { kind: 'loopParam'; container: BlockDecl }
  | { kind: 'sdk'; name: string }
  | { kind: 'vars' }

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
  /** `file()` references seen so far. */
  refs: number
  /** Bytes of the distinct files read so far. */
  bytes: number
}

export interface CompileContext {
  file: string
  text: string
  reporter: Reporter
  catalog: BlockCatalog
  files: ReadonlyMap<string, string>
  limits: Required<CompileLimits>
  codeFiles: CodeFileBudget
  comments: CommentCollector
  decls: BlockDecl[]
  declsByKey: Map<BlockKey, BlockDecl>
  /** Every block binding by identifier, across scopes, for `E_OUT_OF_SCOPE`. */
  declsByBinding: Map<string, BlockDecl[]>
  variables: Map<VarKey, CanonicalVariable>
  wiring: WiringStatement[]
  implied: ImpliedEdge[]
  spans: Map<AnchorKey, SourceSpan>
  /** `CompileInput.knownKeys`: the only keys a `meta.key` override may name. */
  knownKeys: ReadonlySet<BlockKey>
}

/** Anything with Babel-style offsets. */
interface Located {
  start?: number | null
  end?: number | null
}

export function rangeOf(ctx: CompileContext, node: Located): Range {
  const start = node.start ?? 0
  return { file: ctx.file, start, end: node.end ?? start }
}

/** Records an anchor's span the first time it is seen. */
export function recordSpan(ctx: CompileContext, anchor: Anchor, node: Located): AnchorKey {
  const key = encodeAnchor(anchor)
  if (!ctx.spans.has(key)) ctx.spans.set(key, ctx.reporter.span(rangeOf(ctx, node)))
  return key
}

export function lookup(scope: Scope, name: string): Binding | null {
  for (let current: Scope | null = scope; current; current = current.parent) {
    const binding = current.bindings.get(name)
    if (binding) return binding
  }
  return null
}

/** Every identifier visible from `scope`, innermost first, for did-you-mean. */
export function visibleNames(scope: Scope): string[] {
  const names: string[] = []
  for (let current: Scope | null = scope; current; current = current.parent) {
    names.push(...current.bindings.keys())
  }
  return names
}

/** The enclosing containers of a declaration, innermost first (not the declaration itself). */
export function enclosingContainers(decl: BlockDecl): BlockDecl[] {
  const chain: BlockDecl[] = []
  for (let current = decl.parent; current; current = current.parent) chain.push(current)
  return chain
}

export function catalogBlockOf(decl: BlockDecl): CatalogBlock | undefined {
  switch (decl.builder.kind) {
    case 'catalog':
    case 'generic':
      return decl.builder.block
    default:
      return undefined
  }
}

export function containerKindOf(decl: BlockDecl): 'loop' | 'parallel' | null {
  return decl.builder.kind === 'container' ? decl.builder.container : null
}
