/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readScope, recordEffects, fetcher, routeMatcher } = vi.hoisted(() => ({
  readScope: vi.fn(),
  recordEffects: vi.fn(async () => {}),
  fetcher: vi.fn(),
  routeMatcher: vi.fn(),
}))
vi.mock('@/lib/api/server/routes/in-process-transport', () => ({ matchV2Route: routeMatcher }))
vi.mock('@/lib/core/utils/urls', () => ({ getInternalApiBaseUrl: () => 'http://internal-sim' }))
vi.mock('@/lib/mothership/tools/sandbox-resources', () => ({
  readSandboxResourceScope: readScope,
  recordSandboxResourceEffects: recordEffects,
}))

import { isInternalRequest } from '@/lib/api/server/routes/internal-request'
import { proxySandboxResourceRequest } from '@/lib/mothership/tools/sandbox-resource-transport'

const token = 'c46a460d-cd4b-4cda-93b6-1910774b6cab'
const prefix = `https://public-sim/api/mothership/sandbox/${token}`
const scope = {
  runId: 'run',
  toolCallId: 'call',
  userId: 'user',
  chatId: 'chat',
  workspaceId: 'workspace',
  ownerToken: 'owner',
  apiKeyHash: 'hash',
}

function request(path: string, init?: RequestInit) {
  return new Request(`${prefix}${path}`, {
    ...init,
    headers: { 'x-api-key': 'delegation', 'content-type': 'application/json', ...init?.headers },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  readScope.mockResolvedValue(scope)
  routeMatcher.mockReturnValue({
    params: { tableId: 'table' },
    load: async () => ({ GET: fetcher, POST: fetcher }),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network hop')
    })
  )
})

describe('private sandbox v2 resource transport', () => {
  it('preserves the actual request and response while observing a confirmed row mutation', async () => {
    const body = '{"rows":[{"name":"Ada"}]}'
    fetcher.mockImplementation(async (input: Request) => {
      expect(input.url).toBe('http://internal-sim/api/v2/tables/table/rows?workspaceId=workspace')
      expect(input.method).toBe('POST')
      expect(isInternalRequest(input)).toBe(false)
      expect(input.redirect).toBe('manual')
      expect(input.headers.get('x-api-key')).toBe('delegation')
      expect(input.headers.get('cookie')).toBeNull()
      expect(input.headers.get('content-length')).toBe(String(body.length))
      expect(await input.text()).toBe(body)
      return Response.json({ data: { inserted: 1 } })
    })
    const response = await proxySandboxResourceRequest(
      request('/api/v2/tables/table/rows?workspaceId=workspace', {
        method: 'POST',
        body,
        headers: { cookie: 'untrusted=session', 'content-length': String(body.length) },
      }),
      token
    )
    expect(await response.json()).toEqual({ data: { inserted: 1 } })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(recordEffects).toHaveBeenCalledWith(token, scope, [
      {
        op: 'upsert',
        resource: { type: 'table', id: 'table' },
        effectId: expect.stringMatching(/^run:call:/),
      },
    ])
  })

  it('returns the original API authorization failure without emitting effects', async () => {
    fetcher.mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }))
    const response = await proxySandboxResourceRequest(
      request('/api/v2/tables/table/rows?workspaceId=other', { method: 'POST', body: '{}' }),
      token
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0].url).toBe(
      'http://internal-sim/api/v2/tables/table/rows?workspaceId=other'
    )
    expect(recordEffects).toHaveBeenCalledWith(token, scope, [])
  })

  it('lets the canonical handler authorize cross-workspace reads under the personal delegation key', async () => {
    fetcher.mockImplementation(async (input: Request) => {
      expect(input.url).toBe('http://internal-sim/api/v2/tables?workspaceId=other')
      expect(input.headers.get('x-api-key')).toBe('delegation')
      expect(isInternalRequest(input)).toBe(false)
      return Response.json({ data: [] })
    })
    const response = await proxySandboxResourceRequest(
      request('/api/v2/tables?workspaceId=other'),
      token
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [] })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects stale scopes and non-v2 destinations before dispatch', async () => {
    readScope.mockResolvedValue(null)
    expect((await proxySandboxResourceRequest(request('/api/v2/tables'), token)).status).toBe(403)
    readScope.mockResolvedValue(scope)
    expect((await proxySandboxResourceRequest(request('/api/v2/tables/%XY'), token)).status).toBe(
      400
    )
    expect(
      (await proxySandboxResourceRequest(request('/api/internal/secrets'), token)).status
    ).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('forwards binary downloads intact and does not follow redirects', async () => {
    const bytes = new Uint8Array([0, 255, 137, 65])
    fetcher.mockResolvedValue(
      new Response(bytes, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename=x.bin',
        },
      })
    )
    const response = await proxySandboxResourceRequest(
      request('/api/v2/files/file/download'),
      token
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-disposition')).toBe('attachment; filename=x.bin')
    fetcher.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } })
    )
    expect((await proxySandboxResourceRequest(request('/api/v2/meta'), token)).status).toBe(302)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([input]) => input.redirect === 'manual')).toBe(true)
  })

  it('does not turn a successful malformed projection into a mutation retry', async () => {
    fetcher.mockResolvedValue(Response.json({ unexpected: 'committed' }))
    const response = await proxySandboxResourceRequest(
      request('/api/v2/tables', { method: 'POST', body: '{}' }),
      token
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ unexpected: 'committed' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('preserves multipart request bytes for public uploads', async () => {
    const body =
      '--boundary\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\n\r\nhello\r\n--boundary--'
    fetcher.mockImplementation(async (input: Request) => {
      expect(input.headers.get('content-type')).toBe('multipart/form-data; boundary=boundary')
      expect(await input.text()).toBe(body)
      return Response.json({ data: {} }, { status: 400 })
    })
    const response = await proxySandboxResourceRequest(
      request('/api/v2/files', {
        method: 'POST',
        body,
        headers: { 'content-type': 'multipart/form-data; boundary=boundary' },
      }),
      token
    )
    expect(response.status).toBe(400)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown v2 routes and methods without dispatch or network fallback', async () => {
    routeMatcher.mockReturnValueOnce(null)
    expect((await proxySandboxResourceRequest(request('/api/v2/not-real'), token)).status).toBe(404)
    expect(
      (await proxySandboxResourceRequest(request('/api/v2/tables', { method: 'PATCH' }), token))
        .status
    ).toBe(405)
    expect(fetcher).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves HEAD semantics while using the public GET handler', async () => {
    fetcher.mockResolvedValue(Response.json({ data: [] }))
    const response = await proxySandboxResourceRequest(
      request('/api/v2/tables', { method: 'HEAD' }),
      token
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(fetcher.mock.calls[0]?.[0].method).toBe('HEAD')
  })
})
