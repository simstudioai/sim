import { describe, expect, it } from 'vitest'
import { v2ListLogsQuerySchema, v2LogParamsSchema } from '@/lib/api/contracts/v2/logs'
import { v2WorkflowRunIdSchema } from '@/lib/api/contracts/v2/workflows'

const OVERSIZED_RUN_ID = 'r'.repeat(129)

/**
 * `runId` names the same rows on the run resources and on the log resources, so
 * a bound enforced on one and not the other only decides which endpoint an
 * unbounded value reaches the database through. These pin both surfaces to the
 * single shared primitive.
 */
describe('v2 run identifier', () => {
  it.each([
    ['run resource', (value: string) => v2WorkflowRunIdSchema.safeParse(value).success],
    ['log path param', (value: string) => v2LogParamsSchema.safeParse({ runId: value }).success],
    [
      'log list filter',
      (value: string) =>
        v2ListLogsQuerySchema.safeParse({ workspaceId: 'workspace-1', runId: value }).success,
    ],
  ])('bounds the run identifier on the %s', (_surface, accepts) => {
    expect(accepts('run_8f14e45f-ceea-467f-a')).toBe(true)
    expect(accepts(OVERSIZED_RUN_ID)).toBe(false)
    expect(accepts('')).toBe(false)
  })
})
