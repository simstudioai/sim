import type { TraceSpan } from '@/lib/logs/types'

/** Block tree with timing and cost, without input/output. */
export interface OverviewSpan {
  id: string
  blockId?: string
  name: string
  type: string
  status?: string
  durationMs: number
  cost?: TraceSpan['cost']
  children?: OverviewSpan[]
}

/** Project trace spans to a compact overview tree. Never materializes refs. */
export function toOverview(spans: TraceSpan[]): OverviewSpan[] {
  return spans.map((s) => {
    const node: OverviewSpan = {
      id: s.id,
      blockId: s.blockId,
      name: s.name,
      type: s.type,
      status: s.status,
      durationMs: s.duration ?? 0,
    }
    if (s.cost) node.cost = s.cost
    if (s.children && s.children.length > 0) node.children = toOverview(s.children)
    return node
  })
}
