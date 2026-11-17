import type { CallExpression, Expression, Node } from '@babel/types'
import {
  getWorkflowEdgeScopeDropReason,
  parseWorkflowSourceHandle,
  type WorkflowEdgeScopeBlock,
} from '@sim/workflow-types/workflow'
import { edgeTupleKey, portKey } from '../anchors'
import { catalogBlock } from '../catalog/view'
import type { AnchorKey, BlockKey, CanonicalBlock, CanonicalEdge, Port } from '../model'
import { setOwn } from '../records'
import {
  type BlockDecl,
  type CompileContext,
  catalogBlockOf,
  containerKindOf,
  lookup,
  rangeOf,
  recordSpan,
  reportUnresolvedIdentifier,
  type Scope,
  type WiringStatement,
} from './context'
import { HINTS, hintForNode, nodeLabel } from './hints'
import { literalText } from './values'

/** A wiring source: a block and, when written explicitly, the port (`cond.key`, `p`). */
interface Endpoint {
  decl: BlockDecl
  port: Port | null
}

/**
 * The port `edge(a, handle, b)` denotes, read as canonicalize reads a stored handle
 * (`parseWorkflowSourceHandle`): a subflow handle is a subflow port only on a container of its own
 * kind, so `'loop-start-source'` on a parallel stays a raw port. The printer writes `edge()` for
 * edges with no fluent form: the `out` port of a condition, router or container (`'source'`), and
 * raw handles. Branch handles name stored row ids, which source never holds, so they stay raw.
 */
function portForHandle(handle: string, from: BlockDecl): Port {
  const parsed = parseWorkflowSourceHandle(handle, containerKindOf(from) ?? undefined, undefined)
  return parsed.kind === 'branch' ? { kind: 'raw', handle } : parsed
}

/** Implicit branch keys of a never-persisted branch list. */
const IMPLICIT_BRANCHES = { condition: ['if', 'else'], router: ['route0'] } as const

/** Pass 2 of wiring: validates each edge a wiring statement denotes and collects accepted ones. */
export class EdgeCollector {
  readonly edges: CanonicalEdge[] = []
  /** Set once wiring would exceed `limits.maxEdges`; every later edge is dropped unchecked. */
  private full = false
  private readonly seen = new Set<string>()
  private readonly scopeBlocks: Record<string, WorkflowEdgeScopeBlock> = {}

  constructor(
    private readonly ctx: CompileContext,
    private readonly blocks: ReadonlyMap<string, CanonicalBlock>
  ) {
    for (const decl of ctx.decls) {
      if (decl.duplicate) continue
      setOwn(this.scopeBlocks, decl.key, {
        type: containerKindOf(decl) ?? catalogBlockOf(decl)?.type ?? '',
        data: decl.parent ? { parentId: decl.parent.key } : {},
      })
    }
  }

  private error(
    code: Parameters<CompileContext['reporter']['report']>[0],
    message: string,
    node: Node,
    { hint, blockKey }: { hint?: string; blockKey?: BlockKey } = {}
  ) {
    this.ctx.reporter.report(code, message, rangeOf(this.ctx, node), { hint, blockKey })
  }

  /** Validates and records one edge; `false` when it was rejected. */
  add(
    from: BlockDecl,
    port: Port,
    to: BlockDecl,
    node: Node,
    anchors: AnchorKey[],
    viaEdgeCall = false
  ): boolean {
    if (this.full) return false
    const source = this.blocks.get(from.key)
    const target = this.blocks.get(to.key)
    if (!source || !target) return false
    const sourceCatalog = catalogBlockOf(from) ?? catalogBlock(this.ctx.catalog, source.type)
    const targetCatalog = catalogBlockOf(to) ?? catalogBlock(this.ctx.catalog, target.type)
    if (sourceCatalog?.graph.annotationOnly || targetCatalog?.graph.annotationOnly) {
      this.error('E_EDGE_NOTE', 'Notes cannot be wired.', node, {
        hint: 'Remove this edge.',
        blockKey: from.key,
      })
      return false
    }
    if (target.triggerMode || targetCatalog?.graph.canBeTarget === false) {
      this.error(
        'E_TARGET_TRIGGER',
        `${to.name} is a trigger; nothing can connect into it.`,
        node,
        { blockKey: from.key }
      )
      return false
    }
    if (port.kind === 'error' && sourceCatalog && !sourceCatalog.graph.errorPort) {
      this.error('E_ERROR_PORT_UNSUPPORTED', `${from.name} has no error port.`, node, {
        blockKey: from.key,
      })
      return false
    }
    const scopeReason = getWorkflowEdgeScopeDropReason(
      { source: from.key, target: to.key },
      this.scopeBlocks
    )
    const intoOwnChild = to.parent === from
    const startMismatch = !viaEdgeCall && port.kind === 'subflowStart' && !intoOwnChild
    const endMismatch = !viaEdgeCall && port.kind !== 'subflowStart' && intoOwnChild
    if (scopeReason || startMismatch || endMismatch) {
      this.error(
        'E_EDGE_SCOPE',
        scopeReason ??
          (startMismatch
            ? `${to.name} is not inside ${from.name}.`
            : `${to.name} is inside ${from.name}; start it with the loop parameter.`),
        node,
        {
          hint: 'Wire blocks within one scope; start a subflow body with p.to(block).',
          blockKey: from.key,
        }
      )
      return false
    }
    const tuple = edgeTupleKey(from.key, portKey(port), to.key)
    if (this.seen.has(tuple)) {
      this.error(
        'E_DUPLICATE_EDGE',
        `${from.name} is already wired to ${to.name} from this port.`,
        node,
        { hint: 'Remove the repeated edge.', blockKey: from.key }
      )
      return false
    }
    if (this.edges.length === this.ctx.limits.maxEdges) {
      this.full = true
      this.error(
        'E_LIMIT_EXCEEDED',
        `The wiring adds more than ${this.ctx.limits.maxEdges} edges, the limit.`,
        node,
        { hint: 'Split the workflow, moving parts into child workflows.', blockKey: from.key }
      )
      return false
    }
    this.seen.add(tuple)
    this.edges.push({ from: from.key, port, to: to.key })
    const anchor = { kind: 'edges', block: from.key, port: portKey(port) } as const
    anchors.push(recordSpan(this.ctx, anchor, node))
    return true
  }

  /**
   * The block an argument names. `'reported'` when it is an identifier nothing in scope binds
   * (`reportUnresolvedIdentifier`); `null` for anything else that is not a block binding.
   */
  private blockFor(scope: Scope, node: Node, blockKey?: BlockKey): BlockDecl | 'reported' | null {
    if (node.type !== 'Identifier') return null
    const binding = lookup(scope, node.name)
    if (!binding) {
      reportUnresolvedIdentifier(this.ctx, scope, node, blockKey)
      return 'reported'
    }
    return binding.kind === 'block' ? binding.decl : null
  }

  private branchPort(decl: BlockDecl, key: string, node: Node): Port | null {
    const block = this.blocks.get(decl.key)
    const branches = block?.branches
    if (!block || !branches) {
      this.error('E_UNKNOWN_BRANCH', `${decl.name} has no branches.`, node, {
        hint: 'Only condition and router blocks have branches.',
        blockKey: decl.key,
      })
      return null
    }
    const keys: readonly string[] = branches.rows
      ? branches.rows.map((row) => row.key)
      : IMPLICIT_BRANCHES[branches.kind]
    if (!keys.includes(key)) {
      // The branch was refused where it was declared; that error already covers this wiring.
      if (this.ctx.refusedBranches.get(decl.key)?.has(key)) return null
      this.error('E_UNKNOWN_BRANCH', `${decl.name} has no branch ${key}.`, node, {
        hint: `Branches: ${keys.join(', ')}.`,
        blockKey: decl.key,
      })
      return null
    }
    return { kind: 'branch', key }
  }

  /** The sources a wiring expression denotes, or `null` after reporting. */
  private endpoints(
    scope: Scope,
    node: Expression,
    anchors: AnchorKey[],
    statement: Node
  ): Endpoint[] | null {
    if (node.type === 'Identifier') {
      const binding = lookup(scope, node.name)
      if (binding?.kind === 'block') return [{ decl: binding.decl, port: null }]
      if (binding?.kind === 'subflowScope')
        return [{ decl: binding.container, port: { kind: 'subflowStart' } }]
      if (!binding) return reportUnresolvedIdentifier(this.ctx, scope, node)
      this.error('E_UNSUPPORTED_SYNTAX', `${node.name} is not a block.`, node, {
        hint: 'Wire a block declared with const.',
      })
      return null
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
      const object = node.object
      if (object.type === 'Identifier') {
        const binding = lookup(scope, object.name)
        if (!binding) return reportUnresolvedIdentifier(this.ctx, scope, object)
        if (binding.kind === 'block') {
          const port = this.branchPort(binding.decl, node.property.name, node)
          return port ? [{ decl: binding.decl, port }] : null
        }
      }
    }
    if (node.type === 'CallExpression') {
      const result = this.call(scope, node, anchors, statement)
      if (result === 'void') {
        this.error('E_UNSUPPORTED_SYNTAX', 'onError(...) cannot be chained.', node, {
          hint: 'Start a new statement.',
        })
        return null
      }
      return result
    }
    this.error('E_UNSUPPORTED_SYNTAX', `${nodeLabel(node)} is not a wiring source.`, node, {
      hint: hintForNode(node),
    })
    return null
  }

  private targets(scope: Scope, call: CallExpression, blockKey: BlockKey): BlockDecl[] | null {
    const targets: BlockDecl[] = []
    for (const argument of call.arguments) {
      const decl = this.blockFor(scope, argument, blockKey)
      if (decl === 'reported') return null
      if (!decl) {
        this.error('E_UNSUPPORTED_SYNTAX', 'Wire blocks by their binding.', argument, {
          hint: HINTS.bindInline,
          blockKey,
        })
        return null
      }
      targets.push(decl)
    }
    if (targets.length === 0) {
      this.error('E_UNSUPPORTED_SYNTAX', 'Pass at least one block.', call, {
        hint: 'Write a.to(b).',
        blockKey,
      })
      return null
    }
    return targets
  }

  private defaultPort(endpoint: Endpoint, statement: Node): Port | null {
    if (endpoint.port) return endpoint.port
    if (containerKindOf(endpoint.decl)) return { kind: 'subflowEnd' }
    if (this.blocks.get(endpoint.decl.key)?.branches) {
      this.error(
        'E_NO_DEFAULT_OUTPUT',
        `${endpoint.decl.name} routes through named branches.`,
        statement,
        {
          hint: `Wire a branch: ${endpoint.decl.ident ?? 'block'}.<branch>.to(...).`,
          blockKey: endpoint.decl.key,
        }
      )
      return null
    }
    return { kind: 'out' }
  }

  /** Interprets `x.to(...)`, `x.onError(...)` and `edge(a, handle, b)`. */
  private call(
    scope: Scope,
    call: CallExpression,
    anchors: AnchorKey[],
    statement: Node
  ): Endpoint[] | 'void' | null {
    const callee = call.callee
    if (callee.type === 'Identifier') return this.rawEdge(scope, call, anchors, statement)
    if (
      callee.type !== 'MemberExpression' ||
      callee.computed ||
      callee.property.type !== 'Identifier'
    ) {
      this.error('E_UNSUPPORTED_SYNTAX', 'Not a wiring call.', call, { hint: HINTS.calls })
      return null
    }
    const method = callee.property.name
    if (callee.object.type === 'Super') {
      this.error('E_UNSUPPORTED_SYNTAX', 'super is not a block.', callee.object, {
        hint: HINTS.calls,
      })
      return null
    }
    const sources = this.endpoints(scope, callee.object, anchors, statement)
    const [first] = sources ?? []
    const targets = first ? this.targets(scope, call, first.decl.key) : null
    if (!sources || !targets) return null
    for (const source of sources) {
      let port: Port | null
      if (method === 'onError') {
        port = source.port ? null : { kind: 'error' }
        if (!port) {
          this.error('E_UNSUPPORTED_SYNTAX', 'onError(...) applies to a block.', call, {
            hint: 'Write block.onError(handler).',
            blockKey: source.decl.key,
          })
          return null
        }
      } else {
        port = this.defaultPort(source, statement)
        if (!port) return null
      }
      for (const target of targets) {
        if (!this.add(source.decl, port, target, statement, anchors) && this.full) return null
      }
    }
    if (method === 'onError') return 'void'
    return targets.map((decl) => ({ decl, port: null }))
  }

  private rawEdge(
    scope: Scope,
    call: CallExpression,
    anchors: AnchorKey[],
    statement: Node
  ): 'void' | null {
    const [fromNode, handleNode, toNode, ...extra] = call.arguments
    const from = fromNode ? this.blockFor(scope, fromNode) : null
    const fromKey = from && from !== 'reported' ? from.key : undefined
    const to = toNode ? this.blockFor(scope, toNode, fromKey) : null
    if (from === 'reported' || to === 'reported') return null
    const handle = handleNode ? literalText(handleNode) : null
    if (!from || !to || handle === null || handle === '' || extra.length > 0) {
      this.error('E_UNSUPPORTED_SYNTAX', 'edge() takes (from, handle, to).', call, {
        hint: "Write edge(a, 'handle', b).",
        blockKey: fromKey,
      })
      return null
    }
    if (this.add(from, portForHandle(handle, from), to, statement, anchors, true)) {
      this.ctx.reporter.report(
        'W_RAW_HANDLE',
        `The handle ${handle} is kept verbatim.`,
        rangeOf(this.ctx, statement),
        {
          hint: 'Use .to(), .onError() or a branch when the handle is a standard one.',
          blockKey: from.key,
        }
      )
    }
    return 'void'
  }

  /** Pass 2 for one wiring statement; registers its comment anchor. */
  statement(entry: WiringStatement): void {
    const anchors: AnchorKey[] = []
    const expression = entry.statement.expression
    if (expression.type === 'CallExpression')
      this.call(entry.scope, expression, anchors, entry.statement)
    entry.addItem(entry.statement, anchors[0] ?? null, entry.firstWiring)
    if (entry.firstWiring) recordSpan(this.ctx, { kind: 'wiring' }, entry.statement)
  }

  /** The edge an arrow-expression body implies: `(p) => block(...)` is `p.to(block)`. */
  implied(container: BlockDecl, child: BlockDecl, node: Node): void {
    this.add(container, { kind: 'subflowStart' }, child, node, [])
  }
}
