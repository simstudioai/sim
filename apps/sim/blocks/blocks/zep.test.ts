import { describe, expect, it } from 'vitest'
import { ZepBlock } from '@/blocks/blocks/zep'

describe('ZepBlock', () => {
  const buildParams = ZepBlock.tools.config?.params
  if (!buildParams) throw new Error('ZepBlock.tools.config.params is missing')

  /**
   * An agent tool call passes the operation only in `context`. The mapper must validate and
   * coerce for that operation, not fall back to `create_thread` and reject the call for a
   * missing user ID.
   */
  it('maps an agent tool call for the operation in context', () => {
    const args = { apiKey: 'key', threadId: 'thread_1', limit: '10' }

    expect({ ...args, ...buildParams(args, { operation: 'get_messages' }) }.limit).toBe(10)
  })
})
