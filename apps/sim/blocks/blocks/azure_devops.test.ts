import { describe, expect, it } from 'vitest'
import { AzureDevOpsBlock } from '@/blocks/blocks/azure_devops'
import type { BlockToolParamsContext } from '@/blocks/types'

/** The block's `tools.config.params` mapper; `context` is set on a tool call, absent on the canvas. */
const buildParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => AzureDevOpsBlock.tools.config?.params?.(inputs, context) ?? {}

/**
 * On an agent call the model supplies `continuationToken`/`top`/`iterationPath`/`format` under the
 * tool's own names; the per-operation fields (`pipelinesContinuationToken`, `queryTop`, …) are never
 * rendered in the agent tool input. The handler forwards `{ ...inputs, ...mapped }`.
 */
describe('AzureDevOpsBlock agent tool calls', () => {
  const agentCall = (operation: string, args: Record<string, unknown>): Record<string, unknown> => {
    const inputs = { ...args, operation, organization: 'org', project: 'proj' }
    return { ...inputs, ...buildParams(inputs, { operation }) }
  }

  it.each(['azure_devops_list_pipelines', 'azure_devops_get_comments'])(
    'keeps the model continuationToken on %s',
    (operation) => {
      expect(
        agentCall(operation, { workItemId: 1, continuationToken: 'ct' }).continuationToken
      ).toBe('ct')
    }
  )

  it('keeps the model top on azure_devops_query_work_items', () => {
    expect(agentCall('azure_devops_query_work_items', { wiqlQuery: 'q', top: 5 }).top).toBe(5)
  })

  it('keeps the model iterationPath on azure_devops_update_work_item', () => {
    const mapped = agentCall('azure_devops_update_work_item', {
      workItemId: 1,
      iterationPath: 'proj\\Sprint 2',
    })
    expect(mapped.iterationPath).toBe('proj\\Sprint 2')
  })

  it('keeps the model format on azure_devops_add_comment', () => {
    const mapped = agentCall('azure_devops_add_comment', { workItemId: 1, format: 'markdown' })
    expect(mapped.format).toBe('markdown')
  })

  it('drops a List Builds token left over on the canvas under list pipelines', () => {
    const inputs = { operation: 'azure_devops_list_pipelines', continuationToken: 'stale' }
    expect({ ...inputs, ...buildParams(inputs) }.continuationToken).toBeUndefined()
  })

  it('drops a Create Work Item iteration path left over on the canvas under update', () => {
    const inputs = {
      operation: 'azure_devops_update_work_item',
      workItemId: 1,
      iterationPath: 'stale',
    }
    expect({ ...inputs, ...buildParams(inputs) }.iterationPath).toBeUndefined()
  })
})
