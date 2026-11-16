import type { CallExpression, Expression, Node } from '@babel/types'
import {
  getWorkflowEdgeScopeDropReason,
  type WorkflowEdgeScopeBlock,
} from '@sim/workflow-types/workflow'
import { portKey } from '../anchors'
import { catalogBlock } from '../catalog/view'
import type { AnchorKey, CanonicalBlock, CanonicalEdge, Port } from '../model'
import {
  type BlockDecl,
  type CompileContext,
  catalogBlockOf,
  containerKindOf,
  lookup,
  rangeOf,
  recordSpan,
  type Scope,
  type WiringStatement,
} from './context'
import { HINTS, hintForNode } from './hints'
import { literalText, setOwn } from './values'

/** A wiring source: a block and, when written explicitly, the port (`cond.key`, `p.start`). */
interface Endpoint {
  decl: BlockDecl
  port: Port | null
}

/**
 * The port `edge(a, handle, b)` denotes. The printer writes `edge()` for edges with no fluent form:
 * the `out` port of a condition, router or container (`'source'`), and subflow ports on a block
 * that is not a container. Every other handle is kept verbatim as a raw port.
 */
function portForHandle(handle: string): Port {
  switch (handle) {
    case 'source':
      return { kind: 'out' }
    case 'loop-start-source':
    case 'parallel-start-source':
      return { kind: 'subflowStart' }
    case 'loop-end-source':
    case 'parallel-end-source':
      return { kind: 'subflowEnd' }
    default:
      return { kind: 'raw', handle }
  }
}

/** Implicit branch keys of a never-persisted branch list (A7). */
const IMPLICIT_BRANCHES = { condition: ['if', 'else'], router: ['route0'] } as const

export class EdgeCollector {
  readonly edges: CanonicalEdge[] = []
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
    hint?: string
  ) {
    this.ctx.reporter.report(
      code,
      message,
      rangeOf(this.ctx, node),
      hint === undefined ? {} : { hint }
    )
  }

  /** Validates and records one edge (s3 §4 "Edges"); `false` when it was rejected. */
  add(
    from: BlockDecl,
    port: Port,
    to: BlockDecl,
    node: Node,
    anchors: AnchorKey[],
    viaEdgeCall = false
  ): boolean {
    const source = this.blocks.get(from.key)
    const target = this.blocks.get(to.key)
    if (!source || !target) return false
    const sourceCatalog = catalogBlockOf(from) ?? catalogBlock(this.ctx.catalog, source.type)
    const targetCatalog = catalogBlockOf(to) ?? catalogBlock(this.ctx.catalog, target.type)
    if (sourceCatalog?.graph.annotationOnly || targetCatalog?.graph.annotationOnly) {
      this.error('E_EDGE_NOTE', 'Notes cannot be wired.', node, 'Remove this edge.')
      return false
    }
    if (target.triggerMode || targetCatalog?.graph.canBeTarget === false) {
      this.error('E_TARGET_TRIGGER', `${to.name} is a trigger; nothing can connect into it.`, node)
      return false
    }
    if (port.kind === 'error' && sourceCatalog && !sourceCatalog.graph.errorPort) {
      this.error('E_ERROR_PORT_UNSUPPORTED', `${from.name} has no error port.`, node)
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
        'Wire blocks within one scope; start a subflow body with p.start.to(block).'
      )
      return false
    }
    const tuple = `${from.key}\u0000${portKey(port)}\u0000${to.key}`
    if (this.seen.has(tuple)) {
      this.error(
        'E_DUPLICATE_EDGE',
        `${from.name} is already wired to ${to.name} from this port.`,
        node,
        'Remove the repeated edge.'
      )
      return false
    }
    this.seen.add(tuple)
    this.edges.push({ from: from.key, port, to: to.key })
    const anchor = { kind: 'edges', block: from.key, port: portKey(port) } as const
    anchors.push(recordSpan(this.ctx, anchor, node))
    return true
  }

  private blockFor(scope: Scope, node: Node): BlockDecl | null {
    if (node.type !== 'Identifier') return null
    const binding = lookup(scope, node.name)
    return binding?.kind === 'block' ? binding.decl : null
  }

  private branchPort(decl: BlockDecl, key: string, node: Node): Port | null {
    const block = this.blocks.get(decl.key)
    const branches = block?.branches
    if (!block || !branches) {
      this.error(
        'E_UNKNOWN_BRANCH',
        `${decl.name} has no branches.`,
        node,
        'Only condition and router blocks have branches.'
      )
      return null
    }
    const keys: readonly string[] = branches.rows
      ? branches.rows.map((row) => row.key)
      : IMPLICIT_BRANCHES[branches.kind]
    if (!keys.includes(key)) {
      this.error(
        'E_UNKNOWN_BRANCH',
        `${decl.name} has no branch ${key}.`,
        node,
        `Branches: ${keys.join(', ')}.`
      )
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
      if (binding?.kind === 'loopParam')
        return [{ decl: binding.container, port: { kind: 'subflowStart' } }]
      this.error('E_UNKNOWN_IDENTIFIER', `${node.name} is not a block.`, node)
      return null
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
      const object = node.object
      if (object.type === 'Identifier') {
        const binding = lookup(scope, object.name)
        if (binding?.kind === 'loopParam' && node.property.name === 'start') {
          return [{ decl: binding.container, port: { kind: 'subflowStart' } }]
        }
        if (binding?.kind === 'block') {
          const port = this.branchPort(binding.decl, node.property.name, node)
          return port ? [{ decl: binding.decl, port }] : null
        }
      }
    }
    if (node.type === 'CallExpression') {
      const result = this.call(scope, node, anchors, statement)
      if (result === 'void') {
        this.error(
          'E_UNSUPPORTED_SYNTAX',
          'onError(...) cannot be chained.',
          node,
          'Start a new statement.'
        )
        return null
      }
      return result
    }
    this.error(
      'E_UNSUPPORTED_SYNTAX',
      `${node.type} is not a wiring source.`,
      node,
      hintForNode(node)
    )
    return null
  }

  private targets(scope: Scope, call: CallExpression): BlockDecl[] | null {
    const targets: BlockDecl[] = []
    for (const argument of call.arguments) {
      const decl = this.blockFor(scope, argument)
      if (!decl) {
        this.error(
          'E_UNSUPPORTED_SYNTAX',
          'Wire blocks by their binding.',
          argument,
          HINTS.bindInline
        )
        return null
      }
      targets.push(decl)
    }
    if (targets.length === 0) {
      this.error('E_UNSUPPORTED_SYNTAX', 'Pass at least one block.', call, 'Write a.to(b).')
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
        `Wire a branch: ${endpoint.decl.binding ?? 'block'}.<branch>.to(...).`
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
      this.error('E_UNSUPPORTED_SYNTAX', 'Not a wiring call.', call, HINTS.calls)
      return null
    }
    const method = callee.property.name
    if (callee.object.type === 'Super') {
      this.error('E_UNSUPPORTED_SYNTAX', 'super is not a block.', callee.object, HINTS.calls)
      return null
    }
    const sources = this.endpoints(scope, callee.object, anchors, statement)
    const targets = sources ? this.targets(scope, call) : null
    if (!sources || !targets) return null
    for (const source of sources) {
      let port: Port | null
      if (method === 'onError') {
        port = source.port ? null : { kind: 'error' }
        if (!port) {
          this.error(
            'E_UNSUPPORTED_SYNTAX',
            'onError(...) applies to a block.',
            call,
            'Write block.onError(handler).'
          )
          return null
        }
      } else {
        port = this.defaultPort(source, statement)
        if (!port) return null
      }
      for (const target of targets) this.add(source.decl, port, target, statement, anchors)
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
    const to = toNode ? this.blockFor(scope, toNode) : null
    const handle = handleNode ? literalText(handleNode) : null
    if (!from || !to || handle === null || handle === '' || extra.length > 0) {
      this.error(
        'E_UNSUPPORTED_SYNTAX',
        'edge() takes (from, handle, to).',
        call,
        "Write edge(a, 'handle', b)."
      )
      return null
    }
    if (this.add(from, portForHandle(handle), to, statement, anchors, true)) {
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

  implied(container: BlockDecl, child: BlockDecl, node: Node): void {
    this.add(container, { kind: 'subflowStart' }, child, node, [])
  }
}
