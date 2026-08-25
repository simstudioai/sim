/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildCostLedger } from '@/lib/logs/cost-ledger'

function usageRow(overrides: Record<string, unknown> = {}) {
  return {
    category: 'model',
    description: 'gpt-5',
    cost: '0.25',
    metadata: null,
    ...overrides,
  }
}

describe('buildCostLedger', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  /**
   * `null` and `[]` are different answers and both are reachable, so neither may
   * stand in for the other: `null` means no ledger exists for the run — it
   * predates the ledger, or it is a job run, whose costs are not recorded under
   * the workflow source this reads.
   */
  it('reports no ledger rather than an empty one when nothing was recorded', async () => {
    queueTableRows(schemaMock.usageLog, [])

    expect(await buildCostLedger('run-1')).toBeNull()
  })

  it('folds repeated lines for one item and sums their cost', async () => {
    queueTableRows(schemaMock.usageLog, [usageRow(), usageRow({ cost: '0.75' })])

    expect(await buildCostLedger('run-1')).toEqual({
      total: 1,
      items: [{ category: 'model', description: 'gpt-5', cost: 1 }],
    })
  })

  it('keeps lines that differ in category or description apart', async () => {
    queueTableRows(schemaMock.usageLog, [
      usageRow(),
      usageRow({ category: 'tool', description: 'gpt-5' }),
      usageRow({ description: 'claude-opus-5' }),
    ])

    const ledger = await buildCostLedger('run-1')

    expect(ledger?.items).toHaveLength(3)
    expect(ledger?.total).toBeCloseTo(0.75)
  })

  it('reports token counts per call rather than accumulating them', async () => {
    queueTableRows(schemaMock.usageLog, [
      usageRow({ metadata: { inputTokens: 100, outputTokens: 20 } }),
      usageRow({ metadata: { inputTokens: 400, outputTokens: 5 } }),
    ])

    expect((await buildCostLedger('run-1'))?.items[0]).toMatchObject({
      inputTokens: 400,
      outputTokens: 20,
    })
  })

  it('omits token fields entirely for a line that bills none', async () => {
    queueTableRows(schemaMock.usageLog, [usageRow({ category: 'fixed', description: 'Base fee' })])

    expect((await buildCostLedger('run-1'))?.items[0]).toEqual({
      category: 'fixed',
      description: 'Base fee',
      cost: 0.25,
    })
  })
})
