import type { CallExpression, Expression, Node } from '@babel/types'
import {
  getWorkflowEdgeScopeDropReason,
  parseWorkflowSourceHandle,
  type WorkflowEdgeScopeBlock,
} from '@sim/workflow-types/workflow'
import { edgeTupleKey, portKey } from '../anchors'
import { literalText } from '../babel'
import { catalogBlock } from '../catalog/view'
import type {
  AnchorKey,
  BlockKey,
  CanonicalBlock,
  CanonicalEdge,
  CanonicalWorkflow,
  Port,
} from '../model'
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
  /** The source node each accepted edge was written at, by index into `edges`. */
  private readonly nodes: Node[] = []
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
    // A duplicate shares the first declaration's key, so its edges would wire that block instead
    // (a phantom cycle among them). E_DUPLICATE_NAME already covers it.
    if (from.duplicate || to.duplicate) return false
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
    this.nodes.push(node)
    const anchor = { kind: 'edges', block: from.key, port: portKey(port) } as const
    anchors.push(recordSpan(this.ctx, anchor, node))
    return true
  }

  /**
   * Reports each cycle the accepted wiring closes among enabled blocks, a self-loop included. The
   * executor (`executor/dag`) makes a block wait for every incoming edge from an enabled block, so
   * no block on a cycle ever runs; a disabled block is not in the run graph and breaks a cycle.
   * Repeating work is a loop or parallel container, whose iteration is not an edge. A cycle made
   * only of edges the stored workflow holds is a warning, so stored state keeps round-tripping;
   * any cycle that this source closes is an error.
   */
  reportCycles(stored: CanonicalWorkflow | undefined): void {
    const enabled = (key: string) => this.blocks.get(key)?.enabled !== false
    const outgoing = new Map<string, number[]>()
    this.edges.forEach((edge, index) => {
      if (!enabled(edge.from) || !enabled(edge.to)) return
      const list = outgoing.get(edge.from)
      if (list) list.push(index)
      else outgoing.set(edge.from, [index])
    })
    const storedTuples = new Set(
      (stored?.edges ?? []).map((edge) => edgeTupleKey(edge.from, portKey(edge.port), edge.to))
    )
    for (const component of stronglyConnected([...outgoing.keys()], (key) =>
      (outgoing.get(key) ?? []).map((index) => this.edges[index]?.to ?? key)
    )) {
      const members = new Set(component)
      const inside = component.flatMap((key) =>
        (outgoing.get(key) ?? []).filter((index) => members.has(this.edges[index]?.to ?? ''))
      )
      if (inside.length === 0) continue
      const fresh = inside.filter((index) => {
        const edge = this.edges[index]
        return edge && !storedTuples.has(edgeTupleKey(edge.from, portKey(edge.port), edge.to))
      })
      const candidates = fresh.length > 0 ? fresh : inside
      const at = candidates.find((index) => this.isBackEdge(index)) ?? candidates[0]
      const edge = at === undefined ? undefined : this.edges[at]
      const node = at === undefined ? undefined : this.nodes[at]
      if (!edge || !node) continue
      const nameOf = (key: string) => this.ctx.declsByKey.get(key)?.name ?? key
      const names = component.map(nameOf)
      const message =
        component.length === 1
          ? `${names[0]} is wired to itself, so it waits on its own output and never runs.`
          : `${names.join(', ')} are wired in a cycle; each waits on the one before it, so none of them runs.`
      const back =
        component.length === 1
          ? 'Remove this edge'
          : `Remove this edge from ${nameOf(edge.from)} back to ${nameOf(edge.to)}`
      this.ctx.reporter.report(
        fresh.length > 0 ? 'E_EDGE_CYCLE' : 'W_EDGE_CYCLE',
        message,
        rangeOf(this.ctx, node),
        {
          hint: `${back}, and repeat work with loop() or parallel() around the blocks instead.`,
          blockKey: edge.from,
        }
      )
    }
  }

  /**
   * Whether the edge at `index` points back in source order: its target is declared no later than
   * its source. Every cycle holds one, and it is the edge an author removes to break the cycle.
   */
  private isBackEdge(index: number): boolean {
    const edge = this.edges[index]
    if (!edge) return false
    const from = this.ctx.declsByKey.get(edge.from)
    const to = this.ctx.declsByKey.get(edge.to)
    return from !== undefined && to !== undefined && to.order <= from.order
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

  private targets(
    scope: Scope,
    call: CallExpression,
    blockKey: BlockKey,
    method: string
  ): BlockDecl[] | null {
    const targets: BlockDecl[] = []
    for (const argument of call.arguments) {
      const decl = this.blockFor(scope, argument, blockKey)
      if (decl === 'reported') return null
      if (!decl && argument.type === 'ObjectExpression') {
        this.error(
          'E_UNSUPPORTED_SYNTAX',
          `.${method}() takes blocks only; an edge has no options.`,
          argument,
          {
            hint: "Set a block's options, such as retry, in its builder's third argument: api('Name', { ... }, { retry: { enabled: true, maxTries: 3 } }).",
            blockKey,
          }
        )
        return null
      }
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
    const targets = first ? this.targets(scope, call, first.decl.key, method) : null
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

/**
 * Tarjan's strongly connected components, iterative so a long chain cannot overflow the stack.
 * Each component lists its keys; a single key is a component whether or not it has a self-loop.
 */
function stronglyConnected(
  keys: readonly string[],
  successors: (key: string) => readonly string[]
): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let counter = 0
  for (const root of keys) {
    if (index.has(root)) continue
    const work: Array<{ key: string; next: number }> = [{ key: root, next: 0 }]
    index.set(root, counter)
    low.set(root, counter)
    counter++
    stack.push(root)
    onStack.add(root)
    while (work.length > 0) {
      const frame = work[work.length - 1]
      if (!frame) break
      const targets = successors(frame.key)
      if (frame.next < targets.length) {
        const target = targets[frame.next++]
        if (target === undefined) continue
        if (!index.has(target)) {
          index.set(target, counter)
          low.set(target, counter)
          counter++
          stack.push(target)
          onStack.add(target)
          work.push({ key: target, next: 0 })
        } else if (onStack.has(target)) {
          low.set(frame.key, Math.min(low.get(frame.key) ?? 0, index.get(target) ?? 0))
        }
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent) {
        low.set(parent.key, Math.min(low.get(parent.key) ?? 0, low.get(frame.key) ?? 0))
      }
      if (low.get(frame.key) === index.get(frame.key)) {
        const component: string[] = []
        let member: string | undefined
        do {
          member = stack.pop()
          if (member === undefined) break
          onStack.delete(member)
          component.push(member)
        } while (member !== frame.key)
        components.push(component.reverse())
      }
    }
  }
  return components
}
