/**
 * @vitest-environment node
 */
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/ingest/[[...path]]/route'

const logger = getMockLogger('PostHogProxy')

function createIngestRequest(signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost:3000/ingest/e/', {
    method: 'POST',
    body: '{}',
    signal,
  })
}

describe('PostHog ingest proxy', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('treats a client that disconnects mid-request as a closed request, not a proxy failure', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFetch.mockRejectedValueOnce(new Error('aborted'))

    const response = await POST(createIngestRequest(controller.signal))

    expect(response.status).toBe(499)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('reports an upstream failure while the client is still connected', async () => {
    mockFetch.mockRejectedValueOnce(new Error('The operation timed out.'))

    const response = await POST(createIngestRequest())

    expect(response.status).toBe(502)
    expect(logger.error).toHaveBeenCalledWith(
      'PostHog proxy error',
      expect.objectContaining({ error: 'The operation timed out.' })
    )
  })
})
