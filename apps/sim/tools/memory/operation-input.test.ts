/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { memoryAddTool } from '@/tools/memory/add'
import { memoryDeleteTool } from '@/tools/memory/delete'
import { memoryGetTool } from '@/tools/memory/get'
import { memoryGetAllTool } from '@/tools/memory/get_all'

describe('Memory operation inputs', () => {
  it('materializes semantic inputs without transport or caller-supplied authority', () => {
    expect(memoryAddTool.request).toBeUndefined()
    expect(
      memoryAddTool.operation.input({
        conversationId: 'conversation-1',
        role: 'user',
        content: 'hello',
      })
    ).toEqual({
      key: 'conversation-1',
      data: { role: 'user', content: 'hello' },
    })
    expect(memoryGetTool.operation.input({ id: 'legacy-id' })).toEqual({ id: 'legacy-id' })
    expect(memoryGetAllTool.operation.input({})).toEqual({})
    expect(memoryDeleteTool.operation.input({ conversationId: 'conversation-1' })).toEqual({
      conversationId: 'conversation-1',
    })
  })

  it('preserves the legacy id fallback and required identifier errors', () => {
    expect(
      memoryAddTool.operation.input({ id: 'legacy-id', role: 'user', content: 'hello' })
    ).toEqual({
      key: 'legacy-id',
      data: { role: 'user', content: 'hello' },
    })
    expect(() => memoryGetTool.operation.input({})).toThrow('conversationId or id is required')
    expect(() => memoryDeleteTool.operation.input({})).toThrow('conversationId or id is required')
  })
})
