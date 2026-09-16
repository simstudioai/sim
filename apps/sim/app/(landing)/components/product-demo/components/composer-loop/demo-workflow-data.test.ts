/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DEMO_BLOCKS,
  DEMO_CANVAS,
  DEMO_EDGES,
} from '@/app/(landing)/components/product-demo/components/composer-loop/demo-workflow-data'

describe('demo workflow data', () => {
  const ids = new Set(DEMO_BLOCKS.map((block) => block.id))

  it('wires every edge between known blocks, escalation branch first out of the condition', () => {
    for (const [source, target] of DEMO_EDGES) {
      expect(ids.has(source)).toBe(true)
      expect(ids.has(target)).toBe(true)
    }
    const conditionTargets = DEMO_EDGES.filter(([source]) => source === 'severity').map(
      ([, target]) => target
    )
    expect(conditionTargets).toEqual(['page', 'draft'])
  })

  it('opens with the Start block, then a trigger, and ends on terminals', () => {
    expect(DEMO_BLOCKS[0].id).toBe('start')
    expect(DEMO_BLOCKS[0].isTrigger).toBe(true)
    expect(DEMO_BLOCKS[1].isTrigger).toBe(true)
    for (const id of ['log', 'alert']) {
      expect(DEMO_BLOCKS.find((block) => block.id === id)?.isTerminal).toBe(true)
    }
  })

  it('never stacks two cards on top of each other', () => {
    for (const a of DEMO_BLOCKS) {
      for (const b of DEMO_BLOCKS) {
        if (a === b || a.x !== b.x) continue
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(150)
      }
    }
  })

  it('keeps every card inside the design canvas', () => {
    for (const block of DEMO_BLOCKS) {
      expect(block.x).toBeGreaterThanOrEqual(0)
      expect(block.x + 250).toBeLessThanOrEqual(DEMO_CANVAS.width)
      expect(block.y).toBeGreaterThanOrEqual(0)
      expect(block.y).toBeLessThan(DEMO_CANVAS.height)
    }
  })
})
