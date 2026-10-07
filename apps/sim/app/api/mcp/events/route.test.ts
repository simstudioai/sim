import { authMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { mcpPubsubMock, mcpPubsubMockFns } from '@sim/testing/mocks/mcp-pubsub.mock'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPENED_COMMENT } from '@/lib/events/sse-endpoint'

vi.mock('@/lib/mcp/pubsub', () => mcpPubsubMock)
vi.mock('@/lib/mcp/connection-manager', () => ({
  mcpConnectionManager: { subscribe: () => () => {} },
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET } from '@/app/api/mcp/events/route'

describe('MCP tool-change event stream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    mcpPubsubMockFns.mockReady.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens once tool-change events reach this process', async () => {
    let live: () => void = () => {}
    const ready = new Promise<void>((resolve) => {
      live = resolve
    })
    mcpPubsubMockFns.mockReady.mockReturnValue(ready)
    const response = await GET(new NextRequest('http://localhost/api/mcp/events?workspaceId=ws-1'))
    let first: string | undefined
    if (!response.body) throw new Error('The event stream has no body')
    void response.body
      .getReader()
      .read()
      .then(({ value }) => {
        first = new TextDecoder().decode(value)
      })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(first).toBeUndefined()
    expect(mcpPubsubMockFns.mockReady).toHaveBeenCalledTimes(2)

    live()
    await vi.advanceTimersByTimeAsync(0)
    expect(first).toBe(OPENED_COMMENT)
  })
})
