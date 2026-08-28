/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCloudFormationClient: vi.fn(),
  destroy: vi.fn(),
  parseCapabilities: vi.fn(),
  send: vi.fn(),
  toStackParameters: vi.fn(),
  toStackTags: vi.fn(),
}))

vi.mock('@/lib/internal/cloudformation/client', () => ({
  createCloudFormationClient: mocks.createCloudFormationClient,
  parseCapabilities: mocks.parseCapabilities,
  toStackParameters: mocks.toStackParameters,
  toStackTags: mocks.toStackTags,
}))

import {
  executeCloudformationCreateStack,
  executeCloudformationDescribeStacks,
} from '@/lib/internal/cloudformation/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('CloudFormation operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCloudFormationClient.mockReturnValue({
      send: mocks.send,
      destroy: mocks.destroy,
    })
  })

  it('forwards cancellation across paginated requests and destroys the client', async () => {
    const controller = new AbortController()
    mocks.send
      .mockResolvedValueOnce({
        Stacks: [{ StackName: 'first', StackId: 'first-id', StackStatus: 'CREATE_COMPLETE' }],
        NextToken: 'next-page',
      })
      .mockResolvedValueOnce({
        Stacks: [{ StackName: 'second', StackId: 'second-id', StackStatus: 'UPDATE_COMPLETE' }],
      })

    await expect(
      executeCloudformationDescribeStacks(CONNECTION, controller.signal)
    ).resolves.toEqual({
      success: true,
      output: {
        stacks: [
          {
            stackName: 'first',
            stackId: 'first-id',
            stackStatus: 'CREATE_COMPLETE',
            stackStatusReason: undefined,
            creationTime: undefined,
            lastUpdatedTime: undefined,
            description: undefined,
            enableTerminationProtection: undefined,
            driftInformation: null,
            outputs: [],
            tags: [],
          },
          {
            stackName: 'second',
            stackId: 'second-id',
            stackStatus: 'UPDATE_COMPLETE',
            stackStatusReason: undefined,
            creationTime: undefined,
            lastUpdatedTime: undefined,
            description: undefined,
            enableTerminationProtection: undefined,
            driftInformation: null,
            outputs: [],
            tags: [],
          },
        ],
      },
    })
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.send.mock.calls[1]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('passes transformed stack inputs and cancellation to the SDK', async () => {
    const controller = new AbortController()
    const parameters = [{ ParameterKey: 'Environment', ParameterValue: 'test' }]
    const capabilities = ['CAPABILITY_IAM']
    const tags = [{ Key: 'service', Value: 'sim' }]
    mocks.toStackParameters.mockReturnValue(parameters)
    mocks.parseCapabilities.mockReturnValue(capabilities)
    mocks.toStackTags.mockReturnValue(tags)
    mocks.send.mockResolvedValue({ StackId: 'stack-id' })

    await expect(
      executeCloudformationCreateStack(
        {
          ...CONNECTION,
          stackName: 'stack',
          templateBody: '{}',
          parameters: [
            { parameterKey: 'Environment', parameterValue: 'test', usePreviousValue: false },
          ],
          capabilities: 'CAPABILITY_IAM',
          tags: [{ key: 'service', value: 'sim' }],
          onFailure: 'ROLLBACK',
          timeoutInMinutes: 10,
        },
        controller.signal
      )
    ).resolves.toEqual({ success: true, output: { stackId: 'stack-id' } })

    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({
      StackName: 'stack',
      TemplateBody: '{}',
      Parameters: parameters,
      Capabilities: capabilities,
      Tags: tags,
      OnFailure: 'ROLLBACK',
      TimeoutInMinutes: 10,
    })
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the client when provider execution fails', async () => {
    mocks.send.mockRejectedValue(new Error('provider failure'))

    await expect(executeCloudformationDescribeStacks(CONNECTION)).rejects.toThrow(
      'provider failure'
    )
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
})
