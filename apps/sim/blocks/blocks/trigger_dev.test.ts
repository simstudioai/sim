/**
 * An Agent tool call runs the block mapper over `{ ...storedRowParams, ...modelArgs }` with the
 * operation only in `context`; the tool then receives `{ ...merged, ...mapped }`.
 */
import { describe, expect, it } from 'vitest'
import { TriggerDevBlock } from '@/blocks/blocks/trigger_dev'

function toolCallParams(args: Record<string, unknown>, operation: string) {
  const mapped = TriggerDevBlock.tools.config?.params?.(args, { operation }) ?? {}
  return { ...args, ...mapped }
}

describe('Trigger.dev on an Agent tool call', () => {
  it('keeps the filters the model supplied under the tool param names', () => {
    expect(
      toolCallParams(
        { apiKey: 'tr_dev_x', taskIdentifier: 'send-email', status: 'COMPLETED', pageSize: 10 },
        'trigger_dev_list_runs'
      )
    ).toMatchObject({ taskIdentifier: 'send-email', status: 'COMPLETED', pageSize: 10 })
  })

  it('keeps the deployment status filter the model supplied', () => {
    expect(
      toolCallParams({ apiKey: 'tr_dev_x', status: 'DEPLOYED' }, 'trigger_dev_list_deployments')
    ).toMatchObject({ status: 'DEPLOYED' })
  })
})
