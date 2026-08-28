/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { a2aSendMessageTool } from '@/tools/a2a/send_message'

describe('A2A send message operation input', () => {
  it.each([false, 0, null, ['structured', 'data']])(
    'preserves non-object structured JSON data: %j',
    (data) => {
      expect(
        a2aSendMessageTool.operation.input({
          agentUrl: 'https://agent.example',
          message: 'Hello',
          data,
        })
      ).toHaveProperty('data', data)
    }
  )
})
