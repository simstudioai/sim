import { describe, expect, it } from 'vitest'
import { WebflowBlock } from '@/blocks/blocks/webflow'
import type { BlockToolParamsContext } from '@/blocks/types'

/** The block's `tools.config.params` mapper; `context` is set on a tool call, absent on the canvas. */
const buildParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => WebflowBlock.tools.config?.params?.(inputs, context) ?? {}

/**
 * On an agent call the stored row and model args merge under the tool's param names, the operation
 * reaches the mapper only on `context`, and the result is spread over the merged params.
 */
describe('WebflowBlock agent tool calls', () => {
  const agentCall = (
    operation: string,
    args: Record<string, unknown>
  ): Record<string, unknown> => ({
    ...args,
    ...buildParams(args, { operation }),
  })

  it('trims a model itemId with surrounding whitespace on update', () => {
    const mapped = agentCall('update', {
      oauthCredential: 'cred-1',
      collectionId: '580e63fc8c9a982ac9b8b745',
      itemId: ' 580e64008c9a982ac9b8b754 ',
      fieldData: { name: 'Renamed' },
    })
    expect(mapped).toMatchObject({
      credential: 'cred-1',
      itemId: '580e64008c9a982ac9b8b754',
      fieldData: { name: 'Renamed' },
    })
  })

  it('parses a JSON string fieldData on create', () => {
    const mapped = agentCall('create', {
      oauthCredential: 'cred-1',
      collectionId: '580e63fc8c9a982ac9b8b745',
      fieldData: '{"name":"Post","slug":"post"}',
    })
    expect(mapped.fieldData).toEqual({ name: 'Post', slug: 'post' })
  })
})
