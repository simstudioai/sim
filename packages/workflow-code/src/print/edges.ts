/**
 * Wiring statements: `a.to(b)`, branch and error ports, and `edge(...)` for the rest, each in
 * the scope whose names it needs. Mirrors `compile/edges.ts`.
 */

import { compareStrings } from '@sim/utils/string'
import { getWorkflowSubflowHandleIds } from '@sim/workflow-types/workflow'
import { portKey } from '../anchors'
import { catalogBlock } from '../catalog/view'
import { diagnostic } from '../diagnostics/factory'
import type { AnchorKey, BlockKey, CanonicalEdge, PortKey } from '../model'
import { anchors } from './comments'
import type { PrintContext } from './context'
import { printMember } from './strings'
import { callExpr, type Expr } from './syntax'

/** Whether a block wires its error port. */
export function hasErrorEdge(ctx: PrintContext, key: BlockKey): boolean {
  return (ctx.edgesFrom.get(key) ?? []).some((edge) => edge.port.kind === 'error')
}

/** Whether scope `outer` encloses scope `inner` (or is it): its names are visible there. */
function encloses(ctx: PrintContext, outer: BlockKey | null, inner: BlockKey | null): boolean {
  for (let scope = inner; ; scope = ctx.parentOf.get(scope) ?? null) {
    if (scope === outer) return true
    if (scope === null) return false
  }
}

/**
 * The scope an edge's wiring statement prints in: the source's, unless the target sits in a
 * scope nested inside it (a container's child), where the target's name is visible and the
 * source's still is.
 */
function edgeScope(ctx: PrintContext, edge: CanonicalEdge): BlockKey | null {
  const from = ctx.parentOf.get(edge.from) ?? null
  const to = ctx.parentOf.get(edge.to) ?? null
  return encloses(ctx, from, to) ? to : from
}

/** A wiring source and the edges it prints in one scope, in `edgesFrom` order. */
interface SourceWiring {
  source: BlockKey
  edges: CanonicalEdge[]
}

/** Print scope → the scope of the sources wired there → those sources, in declaration order. */
type ScopeWiring = Map<BlockKey | null, Map<BlockKey | null, SourceWiring[]>>

const wiringByContext = new WeakMap<PrintContext, ScopeWiring>()

/**
 * Every edge bucketed by the scope it prints in ({@link edgeScope}) and then by its source's own
 * scope, built once per print in one pass over the declared blocks, so printing a scope never
 * rescans the blocks of the scopes around it.
 */
function scopeWiring(ctx: PrintContext): ScopeWiring {
  const known = wiringByContext.get(ctx)
  if (known) return known
  const wiring: ScopeWiring = new Map()
  for (const source of ctx.preorder) {
    const sourceScope = ctx.parentOf.get(source) ?? null
    const edgesByScope = new Map<BlockKey | null, CanonicalEdge[]>()
    for (const edge of ctx.edgesFrom.get(source) ?? []) {
      if (!ctx.blocks.has(edge.to)) continue
      const scope = edgeScope(ctx, edge)
      const edges = edgesByScope.get(scope)
      if (edges) edges.push(edge)
      else edgesByScope.set(scope, [edge])
    }
    for (const [scope, edges] of edgesByScope) {
      let bySourceScope = wiring.get(scope)
      if (!bySourceScope) {
        bySourceScope = new Map()
        wiring.set(scope, bySourceScope)
      }
      const sources = bySourceScope.get(sourceScope)
      if (sources) sources.push({ source, edges })
      else bySourceScope.set(sourceScope, [{ source, edges }])
    }
  }
  wiringByContext.set(ctx, wiring)
  return wiring
}

/**
 * The blocks with edges that print in `scope`, each with those edges: the scope's own blocks,
 * then those of every enclosing scope, each scope's in declaration order.
 */
function wiringSources(ctx: PrintContext, scope: BlockKey | null): SourceWiring[] {
  const bySourceScope = scopeWiring(ctx).get(scope)
  if (!bySourceScope) return []
  const sources: SourceWiring[] = []
  for (let outer = scope; ; outer = ctx.parentOf.get(outer) ?? null) {
    sources.push(...(bySourceScope.get(outer) ?? []))
    if (outer === null) return sources
  }
}

function identExpr(ctx: PrintContext, key: BlockKey): Expr {
  return { doc: ctx.idents.get(key) ?? key, shape: 'identifier', depth: 1 }
}

/** The wiring statements of one scope, with the anchor and source block of each. */
export function wiringStatements(
  ctx: PrintContext,
  scope: BlockKey | null
): Array<{ expr: Expr; anchor: AnchorKey; source: BlockKey }> {
  const statements: Array<{ expr: Expr; anchor: AnchorKey; source: BlockKey }> = []
  const byTarget = (a: CanonicalEdge, b: CanonicalEdge) =>
    (ctx.position.get(a.to) ?? 0) - (ctx.position.get(b.to) ?? 0) ||
    (ctx.preorderIndex.get(a.to) ?? -1) - (ctx.preorderIndex.get(b.to) ?? -1)
  const call = (head: string, targets: CanonicalEdge[], method: string): Expr =>
    callExpr(
      `${head}.${method}`,
      [...targets].sort(byTarget).map((edge) => identExpr(ctx, edge.to))
    )
  const raw = (source: BlockKey, handle: string, target: BlockKey): Expr => {
    ctx.diagnostics.push(
      diagnostic('W_RAW_HANDLE', `Edge handle ${handle} has no SDK form; printed as edge().`, {
        blockKey: source,
      })
    )
    return ctx.values.call('edge', [
      identExpr(ctx, source),
      ctx.values.string(handle),
      identExpr(ctx, target),
    ])
  }

  if (scope !== null) {
    const container = ctx.blocks.get(scope)
    const starts = (ctx.edgesFrom.get(scope) ?? []).filter(
      (e) => e.port.kind === 'subflowStart' && ctx.parentOf.get(e.to) === scope
    )
    if (container?.subflow && starts.length > 0) {
      statements.push({
        expr: call(ctx.paramNames.get(scope) ?? 'p', starts, 'to'),
        anchor: anchors.edges(scope, 'subflowStart'),
        source: scope,
      })
    }
  }

  for (const { source, edges } of wiringSources(ctx, scope)) {
    const block = ctx.blocks.get(source)
    if (!block) continue
    const ident = ctx.idents.get(source) ?? source
    const isContainer = block.subflow !== undefined
    const hasBranches =
      block.branches !== undefined ||
      catalogBlock(ctx.catalog, block.type)?.graph.branches !== undefined
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
      let targets = groups.get(port) ?? []
      const anchor = anchors.edges(source, port)
      const first = targets[0]
      if (!first) continue
      const kind = first.port
      if (block.subflow) {
        // A container edge whose handle does not match where its target sits (a start edge out
        // of the container, any other into its own child) has no fluent form; `edge()` keeps
        // its stored handle (W_SUBFLOW_HANDLE_SCOPE).
        const handles = getWorkflowSubflowHandleIds(block.subflow.kind)
        const mismatched = targets.filter(
          (edge) => (ctx.parentOf.get(edge.to) === source) !== (kind.kind === 'subflowStart')
        )
        const handle =
          kind.kind === 'subflowStart'
            ? handles.start
            : kind.kind === 'subflowEnd'
              ? handles.end
              : kind.kind === 'raw'
                ? kind.handle
                : kind.kind === 'error'
                  ? 'error'
                  : 'source'
        for (const edge of [...mismatched].sort(byTarget)) {
          statements.push({ expr: raw(source, handle, edge.to), anchor, source })
        }
        if (kind.kind === 'subflowStart') continue
        targets = targets.filter((edge) => !mismatched.includes(edge))
        if (targets.length === 0) continue
      }
      if (kind.kind === 'subflowStart') {
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
