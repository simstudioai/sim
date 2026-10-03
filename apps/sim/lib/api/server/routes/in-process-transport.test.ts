import { NextRequest } from 'next/server'
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
  dispatchInProcessV2Request,
  matchV2Route,
} from '@/lib/api/server/routes/in-process-transport'

describe('in-process transport', () => {
  it('prefers the more literal pattern and decodes dynamic segments', async () => {
    expect(matchV2Route('/api/v2/blocks/latest')?.params).toEqual({})
    const dynamic = matchV2Route('/api/v2/blocks/slack%20v2')
    expect(dynamic?.params).toEqual({ blockId: 'slack v2' })
    expect(matchV2Route('/api/v2/nowhere')).toBeNull()
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
})
