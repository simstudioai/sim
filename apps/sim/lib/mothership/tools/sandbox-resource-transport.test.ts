import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import {
  mothershipWorkspaceTargetMock,
  mothershipWorkspaceTargetMockFns,
} from '@sim/testing/mocks/mothership-workspace-target.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copilotRequestPrincipal, isCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  type ContentSource,
  noteContentDeliveryOperation,
  requireAdmittedContent,
} from '@/lib/core/application'
import { assertWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { fileCopyOperation } from '@/lib/workspace-files/application/copy-operation'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const { readScope, recordEffects, fetcher, routeMatcher, recordInput } = vi.hoisted(() => ({
  readScope: vi.fn(),
  recordEffects: vi.fn(async () => {}),
  fetcher: vi.fn(),
  routeMatcher: vi.fn(),
  recordInput: vi.fn(),
}))
vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/api/server/routes/in-process-transport', () => ({
  matchV2Route: routeMatcher,
  dispatchInProcessV2Request: (request: Request) => fetcher(request),
}))
vi.mock('@/lib/mothership/tools/sandbox-resources', () => ({
  readSandboxResourceScope: readScope,
  recordSandboxResourceEffects: recordEffects,
}))

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

it('records nothing into the workbench for a route that returns no stored content', async () => {
  routeMatcher.mockReturnValue({
    params: { toolId: 'function_execute' },
    load: async () => ({ GET: fetcher }),
  })
  fetcher.mockResolvedValue(Response.json({ data: { id: 'agent' } }))
  const response = await proxySandboxResourceRequest(
    request('/api/v2/tools/function_execute'),
    token
  )
  expect(await response.json()).toEqual({ data: { id: 'agent' } })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(recordInput).not.toHaveBeenCalled()
})

const CHAT = createDelegatedPrincipal({ serviceId: 'copilot' })
const fileSource = (provenance: ContentSource['provenance']): ContentSource => ({
  kind: 'workspace-file',
  id: 'file',
  provenance,
  view: 'complete',
})

it('replaces a successful response its sourced operation never classified with a 403', async () => {
  routeMatcher.mockReturnValue({ params: { fileId: 'file' }, load: async () => ({ GET: fetcher }) })
  fetcher.mockImplementation(async () => {
    noteContentDeliveryOperation(fileOperations.readContent, CHAT)
    return new Response('unclassified file text')
  })
  const response = await proxySandboxResourceRequest(request('/api/v2/files/file/text'), token)
  expect(response.status).toBe(403)
  expect(await response.text()).not.toContain('unclassified file text')
  expect(recordInput).not.toHaveBeenCalled()
})

const OWNER_ROUTING_REFUSED = {
  status: 403,
  error: 'File owner routing is unavailable or contradictory',
}
const OWNER_PATH_MISMATCH = { status: 400, error: 'File owner does not match the API path' }

it.each([
  [
    'contradictory workspace',
    '/api/v2/projects/project/files',
    1,
    { 'x-mothership-workspace-id': 'workspace' },
    OWNER_ROUTING_REFUSED,
  ],
  ['another Project path', '/api/v2/projects/other/files', 1, {}, OWNER_PATH_MISMATCH],
  ['non-file path', '/api/v2/tables', 1, {}, OWNER_PATH_MISMATCH],
  ['unnegotiated lease', '/api/v2/projects/project/files', undefined, {}, OWNER_ROUTING_REFUSED],
] as const)(
  'refuses %s before a Project callback can dispatch',
  async (_name, path, protocol, headers, refusal) => {
    readScope.mockResolvedValue({ ...scope, fileOwnerProtocolVersion: protocol })
    fetcher.mockResolvedValue(Response.json({ data: [] }))
    const response = await proxySandboxResourceRequest(
      request(path, {
        headers: {
          ...headers,
          'x-mothership-file-owner': JSON.stringify({ entityType: 'project', entityId: 'project' }),
        },
      }),
      token
    )
    expect(response.status).toBe(refusal.status)
    expect(await response.json()).toEqual({ error: refusal.error })
    expect(fetcher).not.toHaveBeenCalled()
  }
)
/**
 * The file read and download use cases refuse a Chat principal no gate observes, so the
 * workbench's reads depend on this proxy installing its session gate around the route handler.
 */
it('admits a workbench file read under the session gate, recording it before the bytes return', async () => {
  routeMatcher.mockReturnValue({ params: { fileId: 'file' }, load: async () => ({ GET: fetcher }) })
  fetcher.mockImplementation(async () => {
    await requireAdmittedContent(CHAT, fileSource({ status: 'exact', entries: [] }))
    return new Response('file text')
  })
  recordInput.mockResolvedValueOnce(undefined)

  const response = await proxySandboxResourceRequest(
    request('/api/v2/files/file/text?workspaceId=workspace'),
    token
  )

  expect(response.status).toBe(200)
  expect(await response.text()).toBe('file text')
  expect(recordInput).toHaveBeenCalledWith(chatSandboxSessionKey(scope.chatId), {
    status: 'exact',
    entries: [],
  })
})

it('withholds a result whose provenance the workbench history could not record', async () => {
  routeMatcher.mockReturnValue({ params: { fileId: 'file' }, load: async () => ({ GET: fetcher }) })
  fetcher.mockImplementation(async () => {
    await requireAdmittedContent(CHAT, fileSource({ status: 'exact', entries: [] }))
    return new Response('file text')
  })
  recordInput.mockRejectedValueOnce(new Error('storage unavailable'))
  const response = await proxySandboxResourceRequest(request('/api/v2/files/file/text'), token)
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('file text')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('reconstructs Project authority from the admitted lease without borrowing its workspace', async () => {
  readScope.mockResolvedValue({ ...scope, fileOwnerProtocolVersion: 1 })
  routeMatcher.mockReturnValue({
    pattern: '/api/v2/projects/{projectId}/files',
    params: { projectId: 'project' },
    load: async () => ({ GET: fetcher }),
  })
  fetcher.mockImplementation(async (request: Request) => {
    const principal = copilotRequestPrincipal(request, projectFileOperations.list, {
      operation: projectFileOperations.list,
      delegationAudience: 'sim:project-files',
    })
    expect(principal).toMatchObject({
      kind: 'resource_delegated',
      subjectUserId: scope.userId,
      invocation: { kind: 'chat', chatId: scope.chatId },
      scope: { kind: 'entity', entityType: 'project', entityId: 'project' },
    })
    expect(principal).not.toHaveProperty('workspaceId')
    return Response.json({ data: [] })
  })
  const response = await proxySandboxResourceRequest(
    request('/api/v2/projects/project/files', {
      headers: {
        'x-mothership-file-owner': JSON.stringify({ entityType: 'project', entityId: 'project' }),
      },
    }),
    token
  )
  expect(response.status).toBe(200)
  expect(target).not.toHaveBeenCalled()
})

const workspaceOwner = { entityType: 'workspace', entityId: 'workspace' }

it.each([
  [
    'a workspace pair',
    {
      source: { owner: workspaceOwner, fileIds: ['file'] },
      destination: { owner: workspaceOwner },
    },
  ],
  ['an invalid body', { source: {} }],
])(
  'keeps %s copy on the workspace route when the lease has no file-owner protocol',
  async (_name, copy) => {
    readScope.mockResolvedValue({ ...scope, fileOwnerProtocolVersion: undefined })
    routeMatcher.mockReturnValue({ params: {}, load: async () => ({ POST: fetcher }) })
    const dispatched: string[] = []
    fetcher.mockImplementation(async (forwarded: Request) => {
      dispatched.push(`${new URL(forwarded.url).pathname} ${await forwarded.text()}`)
      return Response.json({ data: { copied: [] } })
    })
    const body = JSON.stringify(copy)
    const response = await proxySandboxResourceRequest(
      request('/api/v2/files/copy', { method: 'POST', body }),
      token
    )
    expect(response.status).toBe(200)
    expect(dispatched).toEqual([`/api/v2/files/copy ${body}`])
  }
)

it('binds a workspace pair under the paired copy grant on an admitted lease without the protocol', async () => {
  readScope.mockResolvedValue({
    ...scope,
    fileOwnerProtocolVersion: undefined,
    workspaceFileCopy: true,
  })
  routeMatcher.mockReturnValue({
    pattern: '/api/v2/files/copy',
    params: {},
    load: async () => ({ POST: fetcher }),
  })
  fetcher.mockImplementation(async (forwarded: Request) => {
    expect(
      copilotRequestPrincipal(forwarded, fileCopyOperation, {
        operation: fileCopyOperation,
        delegationAudience: fileCopyOperation.delegationAudience,
      })
    ).toMatchObject({
      kind: 'resource_delegated',
      subjectUserId: scope.userId,
      invocation: { kind: 'chat', chatId: scope.chatId },
      scope: { kind: 'file_copy', destination: { owner: workspaceOwner } },
    })
    return Response.json({ data: { copied: [] } })
  })
  const response = await proxySandboxResourceRequest(
    request('/api/v2/files/copy', {
      method: 'POST',
      body: JSON.stringify({
        source: { owner: workspaceOwner, fileIds: ['file'] },
        destination: { owner: workspaceOwner },
      }),
    }),
    token
  )
  expect(response.status).toBe(200)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each([undefined, true as const])(
  'refuses a Project copy destination on a lease without the file-owner protocol (workspace copies %s)',
  async (workspaceFileCopy) => {
    readScope.mockResolvedValue({
      ...scope,
      fileOwnerProtocolVersion: undefined,
      workspaceFileCopy,
    })
    routeMatcher.mockReturnValue({ params: {}, load: async () => ({ POST: fetcher }) })
    const response = await proxySandboxResourceRequest(
      request('/api/v2/files/copy', {
        method: 'POST',
        body: JSON.stringify({
          source: { owner: workspaceOwner, fileIds: ['file'] },
          destination: { owner: { entityType: 'project', entityId: 'project' } },
        }),
      }),
      token
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Paired file owner routing is unavailable or contradictory',
    })
    expect(fetcher).not.toHaveBeenCalled()
  }
)

it('validates a copy body itself once the lease negotiated the file-owner protocol', async () => {
  readScope.mockResolvedValue({ ...scope, fileOwnerProtocolVersion: 1 })
  routeMatcher.mockReturnValue({ params: {}, load: async () => ({ POST: fetcher }) })
  const response = await proxySandboxResourceRequest(
    request('/api/v2/files/copy', { method: 'POST', body: JSON.stringify({ source: {} }) }),
    token
  )
  expect(response.status).toBe(400)
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([undefined, 1 as const])(
  'refuses an oversized streamed copy body at the cap without dispatch (protocol %s)',
  async (fileOwnerProtocolVersion) => {
    readScope.mockResolvedValue({ ...scope, fileOwnerProtocolVersion })
    routeMatcher.mockReturnValue({ params: {}, load: async () => ({ POST: fetcher }) })
    const projectCopy = new TextEncoder().encode(
      JSON.stringify({
        source: { owner: workspaceOwner, fileIds: ['file'] },
        destination: { owner: { entityType: 'project', entityId: 'project' } },
      })
    )
    const padding = new Uint8Array(1024 * 1024).fill(0x20)
    const paddingChunks = Math.ceil((2 * DEFAULT_MAX_JSON_BODY_BYTES) / padding.byteLength)
    let pulledChunks = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulledChunks === 0) controller.enqueue(projectCopy)
        else if (pulledChunks <= paddingChunks) controller.enqueue(padding)
        else controller.close()
        pulledChunks++
      },
    })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half' }
    const response = await proxySandboxResourceRequest(request('/api/v2/files/copy', init), token)
    expect(response.status).toBe(413)
    expect(fetcher).not.toHaveBeenCalled()
    expect(pulledChunks).toBeLessThan(paddingChunks)
  }
)
