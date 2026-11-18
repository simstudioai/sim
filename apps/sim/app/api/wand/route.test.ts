/**
 * @vitest-environment node
 */
import { createMockRequest, createRouteContext } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateInWorkspace } = vi.hoisted(() => ({ mockGenerateInWorkspace: vi.fn() }))

vi.mock('@/lib/wand/application/generate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wand/application/generate')>()),
  generateWandInWorkspace: { execute: mockGenerateInWorkspace },
}))

import { OutboundRoutingError } from '@/lib/core/network/routing'
import { WandStreamStartError } from '@/lib/wand/application/generate'
import { POST } from '@/app/api/wand/route'

const EGRESS_UNAVAILABLE = "The organization's egress route is unavailable"

function wandRequest(stream: boolean) {
  return createMockRequest('POST', { prompt: 'Write a cron', workspaceId: 'ws-1', stream })
}

describe('wand route egress failures', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
  })

  it('answers 503 when the gateway fails a non-streaming generation', async () => {
    mockGenerateInWorkspace.mockRejectedValueOnce(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))
    const response = await POST(wandRequest(false), createRouteContext({}))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ success: false, error: EGRESS_UNAVAILABLE })
  })

  it('answers 503 when the gateway fails to open a stream', async () => {
    mockGenerateInWorkspace.mockRejectedValueOnce(
      new WandStreamStartError(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))
    )
    const response = await POST(wandRequest(true), createRouteContext({}))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ success: false, error: EGRESS_UNAVAILABLE })
  })
})
