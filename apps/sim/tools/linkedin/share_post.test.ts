/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { linkedInSharePostTool } from '@/tools/linkedin/share_post'
import type { SharePostParams } from '@/tools/linkedin/types'

const params: SharePostParams = {
  accessToken: 'token-123',
  text: 'Hello LinkedIn',
}

const profileResult = {
  success: true as const,
  output: { sub: 'abc123' },
}

const mockFetch = vi.fn()
const executeTool = vi.fn()

describe('linkedInSharePostTool.postProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the created post id from the x-restli-id header on an empty 201 body', async () => {
    mockFetch.mockResolvedValue(
      new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:123' },
      })
    )

    const result = await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(result.output.postId).toBe('urn:li:share:123')
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('still reports success with an undefined postId when 201 carries no x-restli-id header', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }))

    const result = await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect('postId' in result.output).toBe(true)
    expect(result.output.postId).toBeUndefined()
  })

  it('surfaces the LinkedIn error body when the response is not ok', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not enough permissions', status: 403 }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Not enough permissions')
  })
})
