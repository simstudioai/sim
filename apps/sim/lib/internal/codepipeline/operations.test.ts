/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCodePipelineClient: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/codepipeline/client', () => ({
  createCodePipelineClient: mocks.createCodePipelineClient,
}))

import {
  executeCodepipelineListPipelines,
  executeCodepipelineStartExecution,
} from '@/lib/internal/codepipeline/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('CodePipeline operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCodePipelineClient.mockReturnValue({
      send: mocks.send,
      destroy: mocks.destroy,
    })
  })

  it('forwards pagination inputs and cancellation to the SDK and destroys the client', async () => {
    const controller = new AbortController()
    mocks.send.mockResolvedValue({
      pipelines: [
        {
          name: 'pipeline',
          version: 3,
          pipelineType: 'V2',
          executionMode: 'QUEUED',
          created: new Date(100),
          updated: new Date(200),
        },
      ],
      nextToken: 'next-page',
    })

    await expect(
      executeCodepipelineListPipelines(
        { ...CONNECTION, maxResults: 20, nextToken: 'current-page' },
        controller.signal
      )
    ).resolves.toEqual({
      success: true,
      output: {
        pipelines: [
          {
            name: 'pipeline',
            version: 3,
            pipelineType: 'V2',
            executionMode: 'QUEUED',
            created: 100,
            updated: 200,
          },
        ],
        nextToken: 'next-page',
      },
    })
    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({
      maxResults: 20,
      nextToken: 'current-page',
    })
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('preserves missing execution ID behavior and destroys the client', async () => {
    mocks.send.mockResolvedValue({})

    await expect(
      executeCodepipelineStartExecution({ ...CONNECTION, pipelineName: 'pipeline' })
    ).rejects.toThrow('No pipeline execution ID returned')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the client when provider execution fails', async () => {
    mocks.send.mockRejectedValue(new Error('provider failure'))

    await expect(executeCodepipelineListPipelines(CONNECTION)).rejects.toThrow('provider failure')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
})
