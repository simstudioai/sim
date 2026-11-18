import { describe, expect, it } from 'vitest'
import { CloudFormationBlock } from '@/blocks/blocks/cloudformation'

/**
 * An agent tool call sends model args under the tool's param names (`description`, `tags`) with
 * the operation only on `context`; the handler forwards `{ ...args, ...mapped }`.
 */
const agentCall = (operation: string, args: Record<string, unknown>): Record<string, unknown> => ({
  ...args,
  ...(CloudFormationBlock.tools.config?.params?.(args, { operation }) ?? {}),
})

describe('CloudFormationBlock agent tool calls', () => {
  it('keeps the model change set description and tags', () => {
    expect(
      agentCall('create_change_set', {
        awsRegion: 'us-east-1',
        awsAccessKeyId: 'AKIA',
        awsSecretAccessKey: 'secret',
        stackName: 'app',
        changeSetName: 'cs-1',
        usePreviousTemplate: true,
        description: 'Bump instance size',
        tags: [{ Key: 'team', Value: 'infra' }],
      })
    ).toMatchObject({
      usePreviousTemplate: true,
      description: 'Bump instance size',
      tags: [{ Key: 'team', Value: 'infra' }],
    })
  })
})
