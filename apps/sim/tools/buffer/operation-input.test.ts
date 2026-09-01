/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { bufferCreatePostTool } from '@/tools/buffer/create_post'
import { bufferEditPostTool } from '@/tools/buffer/edit_post'

describe('Buffer operation declarations', () => {
  it.each([bufferCreatePostTool, bufferEditPostTool])(
    'declares $id as an operation without HTTP metadata',
    (tool) => {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
    }
  )
})
