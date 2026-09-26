import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: {
    listBlocks: vi.fn(),
    getBlock: vi.fn(),
    latestVersion: vi.fn(),
  },
}))

vi.mock('@/lib/api/server/routes/v2-route-table.generated', () => ({
  V2_ROUTES: [
    { pattern: '/api/v2/blocks', load: async () => ({ GET: handlers.listBlocks }) },
    { pattern: '/api/v2/blocks/{blockId}', load: async () => ({ GET: handlers.getBlock }) },
    {
      pattern: '/api/v2/blocks/latest',
      load: async () => ({ GET: handlers.latestVersion }),
    },
  ],
}))

import {
  createInProcessTransport,
  dispatchInProcessV2Request,
  matchV2Route,
} from '@/lib/api/server/routes/in-process-transport'
import { isInternalRequest } from '@/lib/api/server/routes/internal-request'

describe('in-process transport', () => {
  it('prefers the more literal pattern and decodes dynamic segments', async () => {
    expect(matchV2Route('/api/v2/blocks/latest')?.params).toEqual({})
    const dynamic = matchV2Route('/api/v2/blocks/slack%20v2')
    expect(dynamic?.params).toEqual({ blockId: 'slack v2' })
    expect(matchV2Route('/api/v2/nowhere')).toBeNull()
  })

  it('dispatches a v2 request to its route handler in-process, marked internal', async () => {
    handlers.getBlock.mockImplementation(
      async (request: Request, context: { params: Promise<Record<string, string>> }) =>
        NextResponse.json({
          internal: isInternalRequest(request),
          key: request.headers.get('x-api-key'),
          query: new URL(request.url).searchParams.get('workspaceId'),
          params: await context.params,
        })
    )
    const transport = createInProcessTransport()

    const response = await transport('http://internal/api/v2/blocks/agent?workspaceId=ws-1', {
      method: 'GET',
      headers: { 'x-api-key': 'secret' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      internal: true,
      key: 'secret',
      query: 'ws-1',
      params: { blockId: 'agent' },
    })
    expect(handlers.listBlocks).not.toHaveBeenCalled()
  })

  it('dispatches HEAD through GET while retaining HEAD for authorization-only behavior', async () => {
    handlers.getBlock.mockImplementation(async (request: Request) => {
      expect(request.method).toBe('HEAD')
      return new Response(null, { status: 200 })
    })
    const response = await dispatchInProcessV2Request(
      new NextRequest('http://internal/api/v2/blocks/agent', { method: 'HEAD' })
    )
    expect(response?.status).toBe(200)
    expect(handlers.getBlock).toHaveBeenCalledOnce()
  })

  it('falls through to fetch for anything outside the v2 table', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('elsewhere'))
    const transport = createInProcessTransport()

    const response = await transport('http://internal/api/files/serve/abc', { method: 'GET' })

    expect(await response.text()).toBe('elsewhere')
    expect(network).toHaveBeenCalledTimes(1)
    expect(handlers.getBlock).not.toHaveBeenCalled()
  })
})
