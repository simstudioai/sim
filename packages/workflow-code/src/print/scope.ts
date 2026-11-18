/**
 * Print layout: the parent tree, declaration order, identifiers, and which blocks a block can see
 * by name (`visibility`). Mirrors `compile/scope.ts`.
 */

import { catalogBlock, catalogBuilderPaths } from '../catalog/view'
import type { BlockKey, CanonicalBlock } from '../model'
import { getOwn } from '../records'
import type { PrintContext } from './context'
import { assignIdentifiers } from './idents'
import { declarationOrder, type OrderDependency } from './order'
import { referencedHeads } from './refs'

/** A parent chain that loops (corrupt input) is cut at the block that closes it. */
export function breakParentCycles(ctx: PrintContext): void {
  for (const key of ctx.blocks.keys()) {
    const seen = new Set<BlockKey>([key])
    let current = ctx.parentOf.get(key) ?? null
    while (current !== null) {
      if (seen.has(current)) {
        ctx.parentOf.set(key, null)
        break
      }
      seen.add(current)
      current = ctx.parentOf.get(current) ?? null
    }
  }
}

function ancestors(ctx: PrintContext, key: BlockKey): BlockKey[] {
  const chain: BlockKey[] = []
  let current = ctx.parentOf.get(key) ?? null
  while (current !== null) {
    chain.push(current)
    current = ctx.parentOf.get(current) ?? null
  }
  return chain
}

/** The member of `target`'s scope that encloses `from` (or is `from`), if any. */
function enclosingMember(ctx: PrintContext, from: BlockKey, target: BlockKey): BlockKey | null {
  const scope = ctx.parentOf.get(target) ?? null
  for (const candidate of [from, ...ancestors(ctx, from)]) {
    if ((ctx.parentOf.get(candidate) ?? null) === scope) return candidate
  }
  return null
}

/** Whether `target` is visible by name from `from`: in scope and declared before, or why not. */
export function visibility(
  ctx: PrintContext,
  from: BlockKey,
  target: BlockKey
): 'ok' | 'forward' | 'scope' {
  if (from === target) return 'forward'
  const member = enclosingMember(ctx, from, target)
  if (member === null) return 'scope'
  if (member === target) return 'ok'
  const a = ctx.position.get(target) ?? 0
  const b = ctx.position.get(member) ?? 0
  return a < b ? 'ok' : 'forward'
}

/** The callback parameter of the nearest enclosing `kind` container of `from`, if any. */
export function subflowScope(
  ctx: PrintContext,
  from: BlockKey,
  kind: 'loop' | 'parallel'
): string | null {
  for (const ancestor of ancestors(ctx, from)) {
    if (ctx.blocks.get(ancestor)?.subflow?.kind === kind) {
      return ctx.paramNames.get(ancestor) ?? null
    }
  }
  return null
}

function isTrigger(ctx: PrintContext, block: CanonicalBlock): boolean {
  return block.triggerMode || catalogBlock(ctx.catalog, block.type)?.category === 'triggers'
}

/** Orders each scope's declarations and assigns identifiers and container parameter names. */
export function layout(ctx: PrintContext): void {
  const dependencies: OrderDependency[] = []
  for (const [key, block] of ctx.blocks) {
    for (const head of blockRefHeads(block)) {
      if (!ctx.blocks.has(head) || head === key) continue
      const member = enclosingMember(ctx, key, head)
      if (member !== null && member !== head) {
        dependencies.push({ before: head, after: member, hard: true })
      }
    }
  }
  for (const edge of ctx.workflow.edges) {
    if (!ctx.blocks.has(edge.from) || !ctx.blocks.has(edge.to)) continue
    if ((ctx.parentOf.get(edge.from) ?? null) === (ctx.parentOf.get(edge.to) ?? null)) {
      dependencies.push({ before: edge.from, after: edge.to, hard: false })
    }
  }
  const membersOf = new Map<BlockKey | null, BlockKey[]>()
  for (const key of ctx.blocks.keys()) {
    const parent = ctx.parentOf.get(key) ?? null
    const list = membersOf.get(parent) ?? []
    list.push(key)
    membersOf.set(parent, list)
  }
  const visit = (scope: BlockKey | null) => {
    const keys = membersOf.get(scope) ?? []
    const order = declarationOrder(
      keys.map((key) => {
        const block = ctx.blocks.get(key)
        return {
          key,
          isTrigger: block ? isTrigger(ctx, block) : false,
          order: getOwn(ctx.hints.blocks, key)?.order,
        }
      }),
      dependencies
    )
    ctx.scopeMembers.set(scope, order)
    order.forEach((key, index) => {
      ctx.position.set(key, index)
      ctx.preorderIndex.set(key, ctx.preorder.length)
      ctx.preorder.push(key)
      if (ctx.blocks.get(key)?.subflow) visit(key)
    })
  }
  visit(null)

  const reserved = new Set<string>()
  for (const path of catalogBuilderPaths(ctx.catalog)) {
    const [namespace] = path.split('.')
    if (namespace) reserved.add(namespace)
  }
  ctx.idents = assignIdentifiers(
    ctx.preorder.map((key) => ({
      key,
      name: ctx.blocks.get(key)?.name ?? key,
      hint: getOwn(ctx.hints.blocks, key)?.ident,
    })),
    reserved
  )
  const taken = new Set(ctx.idents.values())
  for (const key of ctx.preorder) {
    if (!ctx.blocks.get(key)?.subflow) continue
    const depth = ancestors(ctx, key).filter((a) => ctx.blocks.get(a)?.subflow).length + 1
    let name = depth === 1 ? 'p' : `p${depth}`
    while (taken.has(name)) name = `${name}_`
    ctx.paramNames.set(key, name)
  }
}

function blockRefHeads(block: CanonicalBlock): string[] {
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
