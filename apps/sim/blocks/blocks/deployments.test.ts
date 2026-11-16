import { describe, expect, it } from 'vitest'
import { DeploymentsBlock } from '@/blocks/blocks/deployments'

describe('DeploymentsBlock params on a tool call', () => {
  it('keeps the model version label and description for deploy', () => {
    expect(
      DeploymentsBlock.tools.config?.params?.(
        { workflowId: 'wf-1', name: 'Release 4', description: 'Adds retries' },
        { operation: 'deployments_deploy' }
      )
    ).toEqual({ workflowId: 'wf-1', name: 'Release 4', description: 'Adds retries' })
  })
})
