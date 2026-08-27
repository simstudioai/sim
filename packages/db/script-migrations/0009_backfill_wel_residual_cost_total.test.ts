import { describe, expect, it, vi } from 'vitest'
import {
  backfillWelResidualCostTotal,
  WEL_RESIDUAL_COST_TOTAL_BATCH_SIZE,
  type WelResidualCostTotalBackfillStore,
} from './0009_backfill_wel_residual_cost_total'

describe('backfillWelResidualCostTotal', () => {
  it('projects batches until the candidate set is empty and counts rows changed', async () => {
    const projectBatch = vi
      .fn<WelResidualCostTotalBackfillStore['projectBatch']>()
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(23)
      .mockResolvedValueOnce(0)

    await expect(backfillWelResidualCostTotal({ projectBatch })).resolves.toBe(523)
    expect(projectBatch.mock.calls).toEqual([
      [WEL_RESIDUAL_COST_TOTAL_BATCH_SIZE],
      [WEL_RESIDUAL_COST_TOTAL_BATCH_SIZE],
      [WEL_RESIDUAL_COST_TOTAL_BATCH_SIZE],
    ])
  })

  it('honors a custom batch size', async () => {
    const projectBatch = vi
      .fn<WelResidualCostTotalBackfillStore['projectBatch']>()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)

    await expect(backfillWelResidualCostTotal({ projectBatch }, { batchSize: 2 })).resolves.toBe(2)
    expect(projectBatch).toHaveBeenCalledWith(2)
  })

  it('rejects an invalid batch size', async () => {
    const projectBatch = vi.fn<WelResidualCostTotalBackfillStore['projectBatch']>()

    await expect(backfillWelResidualCostTotal({ projectBatch }, { batchSize: 0 })).rejects.toThrow(
      'positive integer'
    )
    expect(projectBatch).not.toHaveBeenCalled()
  })

  it('fails loudly when the candidate set stops shrinking', async () => {
    const projectBatch = vi
      .fn<WelResidualCostTotalBackfillStore['projectBatch']>()
      .mockResolvedValue(1)

    await expect(backfillWelResidualCostTotal({ projectBatch })).rejects.toThrow('not shrinking')
  })
})
