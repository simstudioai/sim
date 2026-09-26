import {
  mothershipWorkspaceTargetMock,
  mothershipWorkspaceTargetMockFns,
} from '@sim/testing/mocks/mothership-workspace-target.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import { assertWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'

const { readScope, recordEffects, fetcher, routeMatcher, recordInput, mint } = vi.hoisted(() => ({
  readScope: vi.fn(),
  recordEffects: vi.fn(async () => {}),
  fetcher: vi.fn(),
  routeMatcher: vi.fn(),
  recordInput: vi.fn(),
  mint: vi.fn(),
}))
vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/api/server/routes/in-process-transport', () => ({ matchV2Route: routeMatcher }))
vi.mock('@/lib/mothership/tools/sandbox-resources', () => ({
  readSandboxResourceScope: readScope,
  recordSandboxResourceEffects: recordEffects,
}))

import { isInternalRequest } from '@/lib/api/server/routes/internal-request'
import { proxySandboxResourceRequest } from '@/lib/mothership/tools/sandbox-resource-transport'

const target = mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace

urlsMockFns.mockGetInternalApiBaseUrl.mockReturnValue('http://internal-sim')

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
  readScope.mockResolvedValue(scope)
  mint.mockResolvedValue('server-only-identity')
  target.mockResolvedValue({ workspaceId: scope.workspaceId })
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
      expect(input.headers.get('x-api-key')).toBeNull()
      expect(isCopilotRequest(input)).toBe(true)
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
    expect(recordInput).toHaveBeenCalledWith('mothership-chat:chat', false)
    expect(recordInput.mock.invocationCallOrder[0]).toBeLessThan(
      fetcher.mock.invocationCallOrder[0]!
    )
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

  it('keeps ID-only resources bound to the canonical invocation target', async () => {
    fetcher.mockImplementation(async () => {
      try {
        assertWorkspaceInvocationScope({ workspaceId: 'other' })
      } catch {
        return Response.json({ error: 'Resource not found' }, { status: 404 })
      }
      return Response.json({ data: [] })
    })
    const response = await proxySandboxResourceRequest(request('/api/v2/tables/table'), token)
    expect(response.status).toBe(404)
    expect(recordEffects).toHaveBeenCalledWith(token, scope, [])
  })

  it('uses the explicit organization callback target before dispatch and refuses denied targets', async () => {
    const orgScope = { ...scope, workspaceId: undefined, organizationId: 'org' }
    readScope.mockResolvedValue(orgScope)
    target.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Target denied'))
    expect(
      (
        await proxySandboxResourceRequest(
          request('/api/v2/tools', { headers: { 'x-mothership-workspace-id': 'target' } }),
          token
        )
      ).status
    ).toBe(403)
    expect(mint).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    target.mockResolvedValueOnce({ workspaceId: 'target' })
    fetcher.mockImplementation(async (req: Request) => {
      expect(req.headers.get('x-mothership-workspace-id')).toBeNull()
      expect(req.headers.get('x-api-key')).toBeNull()
      expect(isCopilotRequest(req)).toBe(true)
      return Response.json({ data: [] })
    })
    expect(
      (
        await proxySandboxResourceRequest(
          request('/api/v2/tools', { headers: { 'x-mothership-workspace-id': 'target' } }),
          token
        )
      ).status
    ).toBe(200)
    expect(target).toHaveBeenLastCalledWith(orgScope, 'target')
    expect(mint).not.toHaveBeenCalled()
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

vi.mock('@/lib/execution/remote-sandbox/session-file-provenance', () => ({
  recordExistingSessionFileInput: recordInput,
}))

it('refuses delivery before dispatch when provenance cannot be recorded', async () => {
  recordInput.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(proxySandboxResourceRequest(request('/api/v2/tables/table'), token)).rejects.toThrow(
    'storage unavailable'
  )
  expect(fetcher).not.toHaveBeenCalled()
})

it('does not poison public scratch after authenticated static catalog discovery', async () => {
  routeMatcher.mockReturnValue({
    params: { toolId: 'function_execute' },
    load: async () => ({ GET: fetcher }),
  })
  fetcher.mockResolvedValue(Response.json({ data: { id: 'agent' } }))
  await proxySandboxResourceRequest(request('/api/v2/tools/function_execute'), token)
  expect(fetcher).toHaveBeenCalledOnce()
  expect(recordInput).not.toHaveBeenCalled()
})

it.each([
  { status: 'exact', entries: [] },
  { status: 'unknown' },
  { status: 'exact', entries: [{ encryptedValue: 'ciphertext', sourceUserId: 'user' }] },
] as const)(
  'uses typed file provenance from the real public handler without changing admission: %j',
  async (provenance) => {
    routeMatcher.mockReturnValue({
      params: { fileId: 'file' },
      load: async () => ({ GET: fetcher }),
    })
    fetcher.mockImplementation(async (input: Request) => {
      expect(isInternalRequest(input)).toBe(false)
      await reportWorkspaceFileDelivery({
        ...provenance,
        ...('entries' in provenance ? { entries: [...provenance.entries] } : {}),
      })
      return new Response('filebytes')
    })
    const response = await proxySandboxResourceRequest(request('/api/v2/files/file'), token)
    expect(await response.text()).toBe('filebytes')
    expect(recordInput).toHaveBeenCalledWith(
      'mothership-chat:chat',
      provenance.status === 'exact' && provenance.entries.length === 0
    )
    expect(fetcher).toHaveBeenCalledOnce()
  }
)
it('cannot deliver a successful unclassified file response when recording its unknown provenance fails', async () => {
  routeMatcher.mockReturnValue({ params: { fileId: 'file' }, load: async () => ({ GET: fetcher }) })
  fetcher.mockResolvedValue(new Response('unsafe'))
  recordInput.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(proxySandboxResourceRequest(request('/api/v2/files/file'), token)).rejects.toThrow(
    'storage unavailable'
  )
  expect(fetcher).toHaveBeenCalledOnce()
})

vi.mock('@/lib/mothership/chat/delegation', () => ({ mintDelegationToken: mint }))

it('never resolves a real credential for an invalid callback scope', async () => {
  readScope.mockResolvedValue(null)
  expect((await proxySandboxResourceRequest(request('/api/v2/tools'), token)).status).toBe(403)
  expect(mint).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})
it('keeps the server identity out of callback response headers and body', async () => {
  fetcher.mockResolvedValue(Response.json({ data: [] }))
  const response = await proxySandboxResourceRequest(request('/api/v2/tools'), token)
  expect(mint).not.toHaveBeenCalled()
  expect(JSON.stringify([...response.headers])).not.toContain('server-only-identity')
  expect(await response.text()).not.toContain('server-only-identity')
})

it.each(['builtin', 'custom'] as const)(
  'preserves public research scratch only for producer-classified %s block catalog content',
  async (source) => {
    routeMatcher.mockReturnValue({ params: {}, load: async () => ({ GET: fetcher }) })
    fetcher.mockResolvedValue(
      Response.json({
        data: [
          {
            id: 'agent',
            name: 'Agent',
            description: 'Build an agent',
            category: 'blocks',
            source,
            triggerAllowed: false,
            triggerCapable: false,
            triggerIds: [],
            toolIds: [],
            operationIds: [],
            preview: false,
            tags: [],
          },
        ],
        nextCursor: null,
      })
    )
    expect((await proxySandboxResourceRequest(request('/api/v2/blocks'), token)).status).toBe(200)
    if (source === 'builtin') expect(recordInput).not.toHaveBeenCalled()
    else expect(recordInput).toHaveBeenCalledWith('mothership-chat:chat', false)
  }
)
it('does not trust a source label in a malformed catalog result', async () => {
  routeMatcher.mockReturnValue({ params: {}, load: async () => ({ GET: fetcher }) })
  fetcher.mockResolvedValue(Response.json({ data: [{ source: 'builtin' }], nextCursor: null }))
  expect((await proxySandboxResourceRequest(request('/api/v2/blocks'), token)).status).toBe(200)
  expect(recordInput).toHaveBeenCalledWith('mothership-chat:chat', false)
})
