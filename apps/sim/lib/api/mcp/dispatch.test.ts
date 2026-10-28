import { jsonResponse } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { resetUrlsMock, urlsMockFns } from '@sim/testing/mocks/urls.mock'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({ route: vi.fn(), audiences: [] as unknown[] }))

vi.mock('@/lib/api/mcp/catalog', () => {
  const contracts = {
    getTableRow: {
      method: 'GET',
      path: '/api/v2/tables/[tableId]/rows/[rowId]',
      response: { mode: 'json' },
    },
    completeFileUpload: {
      method: 'POST',
      path: '/api/v2/files/uploads/[uploadId]/complete',
      body: z.object({ workspaceId: z.string() }),
      headers: z.object({ 'upload-token': z.string() }),
      response: { mode: 'json' },
    },
  }
  return {
    getMcpOperation: (name: keyof typeof contracts) => ({
      contract: contracts[name],
      handler: async () => mocks.route,
    }),
    callerHeaderNames: (name: string) => (name === 'completeFileUpload' ? ['upload-token'] : []),
  }
})

import { dispatchMcpOperation } from '@/lib/api/mcp/dispatch'
import { getOAuthAccessTokenAudience } from '@/lib/auth/oauth-access-token'

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')
afterAll(resetUrlsMock)

const audience = { resource: 'https://mcp.sim.test/mcp', allowUnboundApiTokens: true }
const context = {
  inbound: createMockRequest({
    method: 'POST',
    url: 'https://mcp.sim.test/mcp',
    headers: { 'x-forwarded-for': '203.0.113.7', cookie: 'session=private' },
  }),
  credential: { apiKey: null, bearer: 'sim_oat_token' },
  audience,
  signal: new AbortController().signal,
}

function dispatched(): NextRequest {
  return mocks.route.mock.calls[0][0]
}

beforeEach(() => {
  mocks.audiences.length = 0
  mocks.route.mockImplementation(async () => {
    mocks.audiences.push(getOAuthAccessTokenAudience())
    return jsonResponse({ data: { ok: true } })
  })
})

describe('dispatchMcpOperation', () => {
  it('builds the HTTP request the route would receive', async () => {
    const result = await dispatchMcpOperation(
      {
        operation: 'getTableRow',
        params: { tableId: 'tbl 1', rowId: 'row-1' },
        query: { workspaceId: 'ws-1', includeDeleted: false, limit: 5 },
      },
      context
    )
    expect(result).toEqual({ content: [{ type: 'text', text: '{"data":{"ok":true}}' }] })
    const request = dispatched()
    expect(request.method).toBe('GET')
    expect(request.url).toBe(
      'https://sim.test/api/v2/tables/tbl%201/rows/row-1?workspaceId=ws-1&includeDeleted=false&limit=5'
    )
    expect(await mocks.route.mock.calls[0][1].params).toEqual({ tableId: 'tbl 1', rowId: 'row-1' })
  })

  it('carries the verified credential and inherited context, never ambient cookies', async () => {
    await dispatchMcpOperation(
      { operation: 'getTableRow', params: { tableId: 't', rowId: 'r' } },
      context
    )
    const headers = dispatched().headers
    expect(headers.get('authorization')).toBe('Bearer sim_oat_token')
    expect(headers.get('x-api-key')).toBeNull()
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7')
    expect(headers.get('x-sim-client-info')).toBe('mcp')
    expect(headers.get('cookie')).toBeNull()
  })

  it('runs the route under the MCP token audience only', async () => {
    await dispatchMcpOperation(
      { operation: 'getTableRow', params: { tableId: 't', rowId: 'r' } },
      context
    )
    expect(mocks.audiences).toEqual([audience])
    expect(getOAuthAccessTokenAudience()).toEqual({})
  })

  it.each([
    [{ tableId: 't' }, 'Missing path parameter rowId.'],
    [{ tableId: 't', rowId: 'r', extra: 'x' }, 'Unknown path parameter extra'],
  ])('rejects wrong path parameters %j', async (params, message) => {
    const result = await dispatchMcpOperation({ operation: 'getTableRow', params }, context)
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining(message) })
    expect(mocks.route).not.toHaveBeenCalled()
  })

  it.each([
    [{ operation: 'getTableRow', params: { tableId: '..', rowId: 'r' } }, 'cannot be "." or ".."'],
    [
      { operation: 'getTableRow', params: { tableId: 't', rowId: 'r' }, body: { x: 1 } },
      'takes no request body',
    ],
    [
      {
        operation: 'completeFileUpload',
        params: { uploadId: 'up-1' },
        body: { workspaceId: 'ws-1', stream: true },
      },
      'Streaming is not supported',
    ],
  ] as const)('refuses a request the route would mishandle: %j', async (call, message) => {
    const result = await dispatchMcpOperation(call, context)
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining(message) })
    expect(mocks.route).not.toHaveBeenCalled()
  })

  it.each(['authorization', 'x-api-key', 'x-forwarded-for'])(
    'refuses to let a tool call set %s',
    async (header) => {
      const result = await dispatchMcpOperation(
        {
          operation: 'completeFileUpload',
          params: { uploadId: 'up-1' },
          headers: { [header]: 'forged' },
        },
        context
      )
      expect(result.isError).toBe(true)
      expect(mocks.route).not.toHaveBeenCalled()
    }
  )

  it('refuses a streaming response', async () => {
    mocks.route.mockResolvedValue(
      new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    )
    const result = await dispatchMcpOperation(
      { operation: 'getTableRow', params: { tableId: 't', rowId: 'r' } },
      context
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('text/event-stream') })
  })

  it('refuses a result too large to return', async () => {
    mocks.route.mockResolvedValue(jsonResponse({ data: 'x'.repeat(1024 * 1024) }))
    const result = await dispatchMcpOperation(
      { operation: 'getTableRow', params: { tableId: 't', rowId: 'r' } },
      context
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('too large') })
  })
})
