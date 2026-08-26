/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  cloudwatchLogGroupsBodySchema,
  cloudwatchSelectorLogGroupsBodySchema,
  cloudwatchSelectorLogGroupsContract,
  cloudwatchSelectorLogStreamsContract,
} from '@/lib/api/contracts/selectors/cloudwatch'

describe('CloudWatch selector contracts', () => {
  it('separates reference-friendly wire validation from resolved region validation', () => {
    const wire = {
      workflowId: 'workflow-1',
      accessKeyId: '{{AWS_ACCESS_KEY_ID}}',
      secretAccessKey: '{{AWS_SECRET_ACCESS_KEY}}',
      region: '{{AWS_REGION}}',
    }

    expect(cloudwatchSelectorLogGroupsBodySchema.safeParse(wire).success).toBe(true)
    expect(cloudwatchLogGroupsBodySchema.safeParse(wire).success).toBe(false)
    expect(
      cloudwatchLogGroupsBodySchema.safeParse({
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'resolved-secret',
        region: 'us-east-1',
      }).success
    ).toBe(true)
  })

  it('keeps selector responses strict and name-only', () => {
    expect(
      cloudwatchSelectorLogGroupsContract.response.schema.safeParse({
        logGroups: [{ logGroupName: 'group' }],
      }).success
    ).toBe(true)
    expect(
      cloudwatchSelectorLogGroupsContract.response.schema.safeParse({
        logGroups: [{ logGroupName: 'group', arn: 'secret-metadata' }],
      }).success
    ).toBe(false)
    expect(
      cloudwatchSelectorLogStreamsContract.response.schema.safeParse({
        logStreams: [{ logStreamName: 'stream', storedBytes: 42 }],
      }).success
    ).toBe(false)
  })
})
