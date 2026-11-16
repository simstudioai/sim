import { describe, expect, it } from 'vitest'
import { SSMBlock } from '@/blocks/blocks/ssm'

const mapParams = SSMBlock.tools.config?.params
if (!mapParams) {
  throw new Error('SSM block must define tools.config.params')
}

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'secret',
}

/**
 * On an agent tool call the operation arrives only on `context` and the model's args are keyed by
 * the tool's param names, so the mapper must coerce them and never replace them with an empty
 * block-only field.
 */
describe('SSM block agent tool calls', () => {
  it.each([
    {
      operation: 'get_parameters',
      args: { names: '["/app/db","/app/key"]' },
      expected: { names: ['/app/db', '/app/key'] },
    },
    {
      operation: 'get_parameter',
      args: { name: '/app/db', withDecryption: 'true' },
      expected: { name: '/app/db', withDecryption: true },
    },
  ])('$operation keeps and coerces the model args', ({ operation, args, expected }) => {
    const merged = { ...CONNECTION, ...args }
    expect({ ...merged, ...mapParams(merged, { operation }) }).toMatchObject(expected)
  })
})
