/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { awsSsmCancelCommandContract } from '@/lib/api/contracts/tools/aws/ssm-cancel-command'
import { createUserToolSchema } from '@/tools/params'
import { cancelCommandTool } from '@/tools/ssm/cancel_command'

const COMMAND_ID = '11111111-2222-3333-4444-555555555555'
const INSTANCE_ID = 'i-0123456789abcdef0'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('ssm_cancel_command published schema', () => {
  const schema = createUserToolSchema(cancelCommandTool)

  it('advertises instanceIds as an array of strings, not an object', () => {
    expect(schema.properties.instanceIds).toMatchObject({
      type: 'array',
      items: { type: 'string' },
      maxItems: 50,
    })
  })

  it('accepts a request shaped the way the published schema advertises', () => {
    const parsed = awsSsmCancelCommandContract.body?.safeParse({
      ...CONNECTION,
      commandId: COMMAND_ID,
      instanceIds: [INSTANCE_ID],
    })

    expect(parsed?.success).toBe(true)
  })
})
