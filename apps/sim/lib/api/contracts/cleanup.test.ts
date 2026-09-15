import { describe, expect, it } from 'vitest'
import { logsCleanupQuerySchema, softDeletesCleanupQuerySchema } from '@/lib/api/contracts/cleanup'

describe('cleanup query limits', () => {
  it('preserves scheduled calls without parameters', () => {
    expect(logsCleanupQuerySchema.parse({})).toBeUndefined()
  })
  it('parses per-type counts', () => {
    expect(logsCleanupQuerySchema.parse({ workflowLogs: '25', jobLogs: '0' })).toEqual({
      workflowLogs: 25,
      jobLogs: 0,
    })
    expect(softDeletesCleanupQuerySchema.parse({ files: '1' })).toEqual({ files: 1 })
  })
  it.each(['', '-1', '1.5', '5001', 'abc', '0'])('rejects invalid count %s', (value) => {
    expect(logsCleanupQuerySchema.safeParse({ workflowLogs: value }).success).toBe(false)
  })
  it('rejects unknown or wrong-endpoint types', () => {
    expect(logsCleanupQuerySchema.safeParse({ files: '1' }).success).toBe(false)
    expect(softDeletesCleanupQuerySchema.safeParse({ workflowLogs: '1' }).success).toBe(false)
  })
})
