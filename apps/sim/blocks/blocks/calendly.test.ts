/**
 * Guards the block/tool contract: the operation dropdown, `tools.access`, the tool params, and the
 * declared inputs all describe the same set of operations, and drift in any one of them fails here.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CalendlyBlock } from '@/blocks/blocks/calendly'
import * as calendlyTools from '@/tools/calendly'

const block: any = CalendlyBlock
const byId = new Map<string, any>(Object.values(calendlyTools).map((t: any) => [t.id, t]))
const ops: string[] = block.subBlocks
  .find((s: any) => s.id === 'operation')
  .options.map((o: any) => o.id)
const access: string[] = block.tools.access
const opSubs = block.subBlocks.filter(
  (s: any) => s.id === 'operation' || !s.condition || s.condition.field === 'operation'
)
const visibleFor = (op: string) =>
  opSubs
    .filter((s: any) => {
      const c = s.condition
      if (!c) return true
      return Array.isArray(c.value) ? c.value.includes(op) : c.value === op
    })
    .map((s: any) => s.id)

describe('calendly block/tool alignment', () => {
  it('every operation maps to a real tool and vice versa', () => {
    expect(ops.filter((o) => !access.includes(o))).toEqual([])
    expect(access.filter((t) => !ops.includes(t))).toEqual([])
    expect(access.filter((t) => !byId.has(t))).toEqual([])
  })

  it('operation-gated subBlock ids are unique', () => {
    const ids = opSubs.map((s: any) => s.id)
    expect(ids.filter((v: string, i: number) => ids.indexOf(v) !== i)).toEqual([])
  })

  it('every required tool param has a visible subBlock for its operation', () => {
    const missing: string[] = []
    for (const op of ops) {
      const tool = byId.get(op)
      const visible = visibleFor(op)
      for (const [name, p] of Object.entries<any>(tool.params)) {
        if (p.visibility === 'hidden' || !p.required) continue
        if (!visible.includes(name)) missing.push(`${op}.${name}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every visible subBlock corresponds to a param on its operation tool', () => {
    const stray: string[] = []
    for (const op of ops) {
      const tool = byId.get(op)
      for (const id of visibleFor(op)) {
        if (id === 'operation' || id === 'selectedTriggerId') continue
        if (!tool.params[id]) stray.push(`${op}.${id}`)
      }
    }
    expect(stray).toEqual([])
  })

  it('every operation-gated subBlock is declared in block.inputs', () => {
    const declared = Object.keys(block.inputs)
    const undeclared = opSubs
      .filter((s: any) => s.id !== 'operation' && s.id !== 'selectedTriggerId' && s.condition)
      .map((s: any) => s.id)
      .filter((id: string) => !declared.includes(id))
    expect(undeclared).toEqual([])
  })
})
