/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import { cloudwatchSelectors } from '@/hooks/selectors/providers/cloudwatch/selectors'

describe('CloudWatch server-resolved selector context', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opts both selectors into all AWS credential fields', () => {
    const fields = ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion']
    expect(cloudwatchSelectors['cloudwatch.logGroups'].serverResolvedContextFields).toEqual(fields)
    expect(cloudwatchSelectors['cloudwatch.logStreams'].serverResolvedContextFields).toEqual(fields)
  })

  it('forwards raw references and maps group names', async () => {
    mocks.requestJson.mockResolvedValue({
      logGroups: [{ logGroupName: '/aws/lambda/example' }],
    })
    const context = {
      workflowId: 'workflow-1',
      awsAccessKeyId: '{{AWS_ACCESS_KEY_ID}}',
      awsSecretAccessKey: '{{AWS_SECRET_ACCESS_KEY}}',
      awsRegion: '{{AWS_REGION}}',
    }

    const options = await cloudwatchSelectors['cloudwatch.logGroups'].fetchList!({
      key: 'cloudwatch.logGroups',
      context,
    })

    expect(options).toEqual([{ id: '/aws/lambda/example', label: '/aws/lambda/example' }])
    expect(mocks.requestJson.mock.calls[0][1].body).toEqual({
      workflowId: 'workflow-1',
      accessKeyId: '{{AWS_ACCESS_KEY_ID}}',
      secretAccessKey: '{{AWS_SECRET_ACCESS_KEY}}',
      region: '{{AWS_REGION}}',
    })
  })

  it('requires workflow scope and keeps literal AWS values out of base query keys', () => {
    const definition = cloudwatchSelectors['cloudwatch.logGroups']
    const context = {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      awsAccessKeyId: 'AKIA-LITERAL-SECRET',
      awsSecretAccessKey: 'aws-literal-secret',
      awsRegion: 'us-secret-1',
    }
    const key = definition.getQueryKey!({
      key: 'cloudwatch.logGroups',
      context,
    })

    expect(definition.enabled?.({ key: 'cloudwatch.logGroups', context })).toBe(true)
    expect(
      definition.enabled?.({
        key: 'cloudwatch.logGroups',
        context: { ...context, workflowId: undefined },
      })
    ).toBe(false)
    expect(JSON.stringify(key)).not.toContain('AKIA-LITERAL-SECRET')
    expect(JSON.stringify(key)).not.toContain('aws-literal-secret')
    expect(JSON.stringify(key)).not.toContain('us-secret-1')
  })
})
