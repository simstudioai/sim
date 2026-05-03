/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { memoryGetTool } from '@/tools/memory/get'

interface MemoryGetParams {
  _context?: {
    workspaceId?: string
  }
  conversationId?: string
  id?: string
}

describe('memoryGetTool', () => {
  const buildUrl = memoryGetTool.request.url as (params: MemoryGetParams) => string
  const transformResponse = memoryGetTool.transformResponse!

  it('builds an exact memory lookup URL', () => {
    const url = buildUrl({
      _context: { workspaceId: 'workspace-1' },
      conversationId: 'user-123',
    })

    expect(url).toBe('/api/memory/user-123?workspaceId=workspace-1')
    expect(url).not.toContain('query=')
    expect(url).not.toContain('limit=')
  })

  it('encodes legacy id values in the path', () => {
    const url = buildUrl({
      _context: { workspaceId: 'workspace-1' },
      id: 'team/user 123',
    })

    expect(url).toBe('/api/memory/team%2Fuser%20123?workspaceId=workspace-1')
  })

  it('wraps the exact memory response as a single result', async () => {
    const result = await transformResponse(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversationId: 'user-123',
            data: [{ role: 'user', content: 'Remember this' }],
          },
        })
      )
    )

    expect(result).toEqual({
      success: true,
      output: {
        memories: [
          {
            conversationId: 'user-123',
            data: [{ role: 'user', content: 'Remember this' }],
          },
        ],
        message: 'Found 1 memory',
      },
    })
  })
})
