/**
 * @vitest-environment node
 */
import { type createMockLogger, loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { linkedInSharePostTool } from '@/tools/linkedin/share_post'
import type { SharePostParams } from '@/tools/linkedin/types'

const toolLogger = loggerMock.createLogger.mock.results.at(-1)?.value as ReturnType<
  typeof createMockLogger
>

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
        headers: { 'x-restli-id': 'urn:li:ugcPost:7264398217238917120' },
      })
    )

    const result = await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(result.output.postId).toBe('urn:li:ugcPost:7264398217238917120')
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('builds the member-viewable post URL from the returned ugcPost URN', async () => {
    mockFetch.mockResolvedValue(
      new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:ugcPost:7264398217238917120' },
      })
    )

    const result = await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(result.output.postUrl).toBe(
      'https://www.linkedin.com/feed/update/urn:li:ugcPost:7264398217238917120/'
    )
  })

  it('leaves the post URL undefined when there is no ugcPost URN to build it from', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }))

    const result = await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(result.output.postUrl).toBeUndefined()
  })

  it('still reports success with an undefined postId when 201 carries no x-restli-id header', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }))

    const result = await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect('postId' in result.output).toBe(true)
    expect(result.output.postId).toBeUndefined()
  })

  it('warns without leaking post content when 201 carries no x-restli-id header', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }))

    await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(toolLogger.warn).toHaveBeenCalledTimes(1)
    const serialized = JSON.stringify(toolLogger.warn.mock.calls)
    expect(serialized).toContain('x-restli-id')
    expect(serialized).not.toContain(params.text)
    expect(serialized).not.toContain(params.accessToken)
  })

  it('does not warn when the x-restli-id header is present', async () => {
    mockFetch.mockResolvedValue(
      new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:ugcPost:7264398217238917120' },
      })
    )

    await linkedInSharePostTool.postProcess!(profileResult, params, executeTool)

    expect(toolLogger.warn).not.toHaveBeenCalled()
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

describe('linkedInSharePostTool.outputs', () => {
  it('declares exactly the keys postProcess returns', () => {
    expect(Object.keys(linkedInSharePostTool.outputs ?? {}).sort()).toEqual(['postId', 'postUrl'])
  })

  it('names the ugcPost URN family that /v2/ugcPosts actually returns', () => {
    const descriptions = [
      linkedInSharePostTool.outputs?.postId?.description ?? '',
      linkedInSharePostTool.outputs?.postUrl?.description ?? '',
    ]

    for (const description of descriptions) {
      expect(description).toContain('ugcPost')
      expect(description).not.toMatch(/\bshare\b/i)
    }
  })
})
