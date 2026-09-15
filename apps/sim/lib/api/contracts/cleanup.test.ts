import { describe, expect, it } from 'vitest'
import { logsCleanupQuerySchema, softDeletesCleanupQuerySchema } from '@/lib/api/contracts/cleanup'

describe('bounded cleanup contract', () => {
  it('keeps an empty query in scheduled mode', () => {
    expect(logsCleanupQuerySchema.parse({})).toBeUndefined()
    expect(softDeletesCleanupQuerySchema.parse({})).toBeUndefined()
  })
  it('defaults omitted budgets to zero and batches to 25', () => {
    expect(logsCleanupQuerySchema.parse({ workflowLogs: '5', requestId: 'wave_1' })).toMatchObject({
      limits: { workflowLogs: 5, jobLogs: 0, orphanSnapshots: 0 },
      batchSize: 25,
      dryRun: false,
    })
  })
  it.each([
    { workflowLogs: '-1', requestId: 'r' },
    { workflowLogs: '1.5', requestId: 'r' },
    { workflowLogs: '5001', requestId: 'r' },
    { workflowLogs: '1e2', requestId: 'r' },
    { workflowLogs: '', requestId: 'r' },
    { workflowLogs: '1' },
    { workflowLogs: '1', requestId: 'r', batchSize: '501' },
    { workflowLogs: '1', requestId: 'r', batchSize: '0' },
    { workflowLogs: '1', requestId: 'r', dryRun: 'yes' },
    { workflowLogs: '1', requestId: 'r', workflows: '1' },
    { workflowLogs: ['1', '2'], requestId: 'r' },
    { requestId: 'r', dryRun: 'true' },
    { workflowLogs: '0', requestId: 'r' },
  ])('rejects malformed or ineffective requests: %j', (query) => {
    expect(logsCleanupQuerySchema.safeParse(query).success).toBe(false)
  })
})
