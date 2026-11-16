import { describe, expect, it } from 'vitest'
import { CodePipelineV2Block } from '@/blocks/blocks/codepipeline'
import type { BlockToolParamsContext } from '@/blocks/types'

const configuredParams = CodePipelineV2Block.tools.config?.params
if (!configuredParams) {
  throw new Error('CodePipeline block must define tools.config.params')
}
const mapParams = configuredParams

/** The tool-call merge: the mapped params land over the model's args (`{ ...args, ...mapped }`). */
function merge(args: Record<string, unknown>, context?: BlockToolParamsContext) {
  return { ...args, ...mapParams(args, context) }
}

describe('CodePipeline block params', () => {
  it('keeps the model approval decision on a tool call, where the operation is only in the context', () => {
    const merged = merge(
      {
        pipelineName: 'deploy',
        stageName: 'Prod',
        actionName: 'ManualApproval',
        token: 'tok-1',
        status: 'Rejected',
        summary: 'Failing canary',
      },
      { operation: 'put_approval_result' }
    )

    expect(merged.token).toBe('tok-1')
    expect(merged.status).toBe('Rejected')
    expect(merged.summary).toBe('Failing canary')
  })
})
