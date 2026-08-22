/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const {
  mockAuthorizeCredentialUse,
  mockCheckSessionOrInternalAuth,
  mockGetAsyncStatus,
  mockListRecordTypes,
  mockResolveCredentialAccessToken,
  mockResolveOAuthAccountId,
} = vi.hoisted(() => ({
  mockAuthorizeCredentialUse: vi.fn(),
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockGetAsyncStatus: vi.fn(),
  mockListRecordTypes: vi.fn(),
  mockResolveCredentialAccessToken: vi.fn(),
  mockResolveOAuthAccountId: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialAccessToken: mockResolveCredentialAccessToken,
  resolveOAuthAccountId: mockResolveOAuthAccountId,
}))
vi.mock('@/tools/netsuite/get_async_status', () => ({
  netsuiteGetAsyncStatusTool: { directExecution: mockGetAsyncStatus },
}))
vi.mock('@/tools/netsuite/list_record_types', () => ({
  netsuiteListRecordTypesTool: { directExecution: mockListRecordTypes },
}))

import { POST } from '@/app/api/tools/netsuite/objects/route'

const URL = 'http://localhost:3000/api/tools/netsuite/objects'
const ORIGIN = 'https://1234567.suitetalk.api.netsuite.com'
const RECORD_TYPES_BODY = {
  credential: 'credential-1',
  workflowId: 'workflow-1',
  kind: 'record_types',
} as const

function request(
  body: unknown,
  signal?: AbortSignal,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function success(data: unknown) {
  return { success: true, output: { status: 200, data } }
}

function failure(status?: number) {
  return { success: false, output: { status, data: null, error: 'provider secret' } }
}

describe('POST /api/tools/netsuite/objects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockAuthorizeCredentialUse.mockResolvedValue({
      ok: true,
      credentialOwnerUserId: 'owner-1',
      resolvedCredentialId: 'resolved-credential-1',
      credentialType: 'service_account',
    })
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'netsuite-service-account',
    })
    mockResolveCredentialAccessToken.mockResolvedValue({
      accessToken: 'short-lived-token',
      instanceUrl: ORIGIN,
    })
    mockListRecordTypes.mockResolvedValue(success({ items: [{ name: 'customer' }] }))
    mockGetAsyncStatus.mockResolvedValue(success({ items: [] }))
  })

  it.each([
    ['unauthenticated malformed input', '{not-json', {}, 'Unauthorized'],
    [
      'API-key caller',
      RECORD_TYPES_BODY,
      { 'x-api-key': 'external-api-key' },
      'API key access not allowed for this endpoint',
    ],
  ])('authenticates before parsing and rejects an %s', async (_label, body, headers, error) => {
    mockCheckSessionOrInternalAuth.mockResolvedValueOnce({ success: false, error })

    const response = await POST(request(body, undefined, headers), {})

    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({ error })
    expect(mockCheckSessionOrInternalAuth).toHaveBeenCalledWith(expect.any(NextRequest), {
      requireWorkflowId: true,
    })
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid JSON', '{not-json', 400],
    ['removed dataset selector kind', { ...RECORD_TYPES_BODY, kind: 'datasets' }, 400],
    [
      'missing async job',
      { credential: 'credential-1', workflowId: 'workflow-1', kind: 'async_tasks' },
      400,
    ],
    ['unexpected record-type job', { ...RECORD_TYPES_BODY, jobId: 'job-1' }, 400],
    ['oversized body', { ...RECORD_TYPES_BODY, padding: 'x'.repeat(17 * 1024) }, 413],
  ])('rejects %s', async (_label, body, expectedStatus) => {
    const response = await POST(request(body), {})

    expect(response.status).toBe(expectedStatus)
    expect(mockAuthorizeCredentialUse).not.toHaveBeenCalled()
  })

  it('authorizes the exact credential and injects only resolved provider authentication', async () => {
    const controller = new AbortController()
    const discoveryRequest = request(RECORD_TYPES_BODY, controller.signal)
    const response = await POST(discoveryRequest, {})

    expect(response.status).toBe(200)
    expect(mockAuthorizeCredentialUse).toHaveBeenCalledWith(expect.any(NextRequest), {
      credentialId: 'credential-1',
      workflowId: 'workflow-1',
      callerUserId: 'user-1',
    })
    expect(mockResolveOAuthAccountId).toHaveBeenCalledWith('resolved-credential-1')
    expect(mockResolveCredentialAccessToken).toHaveBeenCalledWith(
      'resolved-credential-1',
      'owner-1',
      expect.any(String)
    )
    expect(mockListRecordTypes).toHaveBeenCalledWith(
      {
        oauthCredential: 'resolved-credential-1',
        accessToken: 'short-lived-token',
        instanceUrl: ORIGIN,
      },
      discoveryRequest.signal
    )
  })

  it.each([
    [
      'credential authorization',
      () => mockAuthorizeCredentialUse.mockResolvedValueOnce({ ok: false, error: 'Forbidden' }),
      403,
    ],
    [
      'non-service-account credential',
      () =>
        mockAuthorizeCredentialUse.mockResolvedValueOnce({
          ok: true,
          credentialOwnerUserId: 'owner-1',
          credentialType: 'oauth',
        }),
      400,
    ],
    [
      'wrong service-account provider',
      () =>
        mockResolveOAuthAccountId.mockResolvedValueOnce({
          credentialType: 'service_account',
          providerId: 'snowflake-service-account',
        }),
      400,
    ],
  ])('fails closed on invalid %s', async (_label, arrange, expectedStatus) => {
    arrange()

    const response = await POST(request(RECORD_TYPES_BODY), {})

    expect(response.status).toBe(expectedStatus)
    expect(mockListRecordTypes).not.toHaveBeenCalled()
  })

  it('dispatches async task discovery with the exact job, view, auth, and signal', async () => {
    const body = { ...RECORD_TYPES_BODY, kind: 'async_tasks', jobId: 'job 1' } as const
    const task2 = '/services/rest/async/v1/job/job%201/task/task-2'
    const task1 = `${ORIGIN}/services/rest/async/v1/job/job%201/task/task-1`
    mockGetAsyncStatus.mockResolvedValueOnce(
      success({
        items: [
          { links: [{ rel: 'self', href: task2 }] },
          {
            links: [
              { rel: 'self', href: task1 },
              { rel: 'self', href: task1 },
            ],
          },
        ],
      })
    )

    const discoveryRequest = request(body)
    const response = await POST(discoveryRequest, {})

    expect(response.status).toBe(200)
    expect(mockGetAsyncStatus).toHaveBeenCalledWith(
      {
        oauthCredential: 'resolved-credential-1',
        accessToken: 'short-lived-token',
        instanceUrl: ORIGIN,
        jobId: 'job 1',
        view: 'tasks',
      },
      discoveryRequest.signal
    )
    expect(await json(response)).toEqual({
      objects: [
        { id: 'task-1', label: 'task-1', detail: null },
        { id: 'task-2', label: 'task-2', detail: null },
      ],
    })
  })

  it('skips non-self task link relationships instead of failing discovery', async () => {
    const href = `${ORIGIN}/services/rest/async/v1/job/job-1/task/task-1`
    mockGetAsyncStatus.mockResolvedValueOnce(
      success({
        items: [
          {
            links: [
              { rel: 'canonical', href: `${ORIGIN}/services/rest/async/v1/job/job-1` },
              { rel: 'self', href },
            ],
          },
        ],
      })
    )

    const response = await POST(
      request({ ...RECORD_TYPES_BODY, kind: 'async_tasks', jobId: 'job-1' }),
      {}
    )

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      objects: [{ id: 'task-1', label: 'task-1', detail: null }],
    })
  })

  it('fails discovery when a task entry has no self link', async () => {
    mockGetAsyncStatus.mockResolvedValueOnce(
      success({
        items: [
          { links: [{ rel: 'canonical', href: `${ORIGIN}/services/rest/async/v1/job/job-1` }] },
        ],
      })
    )

    const response = await POST(
      request({ ...RECORD_TYPES_BODY, kind: 'async_tasks', jobId: 'job-1' }),
      {}
    )

    expect(response.status).toBe(502)
  })

  it('normalizes, deduplicates, and sorts up to 1,000 unique record types', async () => {
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      name: `record_${String(999 - index).padStart(4, '0')}`,
    }))
    items.push({ name: 'record_0000' }, { name: 'record_0999' })
    mockListRecordTypes.mockResolvedValueOnce(success({ items }))

    const response = await POST(request(RECORD_TYPES_BODY), {})
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body.objects).toHaveLength(1_000)
    expect((body.objects as { id: string }[]).at(0)?.id).toBe('record_0000')
    expect((body.objects as { id: string }[]).at(-1)?.id).toBe('record_0999')
  })

  it('fails closed instead of returning a partial record-type catalog', async () => {
    mockListRecordTypes.mockResolvedValueOnce(
      success({
        items: Array.from({ length: 1_001 }, (_, index) => ({ name: `record_${index}` })),
      })
    )

    const response = await POST(request(RECORD_TYPES_BODY), {})

    expect(response.status).toBe(502)
    expect(await json(response)).toEqual({
      error: 'NetSuite returned an invalid object-discovery response.',
    })
  })

  it('fails closed on a malformed provider envelope', async () => {
    mockListRecordTypes.mockResolvedValueOnce(success({ items: [{ name: 42 }] }))

    const response = await POST(request(RECORD_TYPES_BODY), {})

    expect(response.status).toBe(502)
    expect(await json(response)).toEqual({
      error: 'NetSuite returned an invalid object-discovery response.',
    })
  })

  it.each([
    ['foreign origin', 'https://evil.example/services/rest/async/v1/job/job-1/task/task-1'],
    ['wrong job', `${ORIGIN}/services/rest/async/v1/job/job-2/task/task-1`],
    ['query string', `${ORIGIN}/services/rest/async/v1/job/job-1/task/task-1?secret=x`],
    ['fragment', `${ORIGIN}/services/rest/async/v1/job/job-1/task/task-1#fragment`],
    ['noncanonical encoding', `${ORIGIN}/services/rest/async/v1/job/job%2D1/task/task-1`],
  ])('rejects a %s task link', async (_label, href) => {
    mockGetAsyncStatus.mockResolvedValueOnce(
      success({ items: [{ links: [{ rel: 'self', href }] }] })
    )

    const response = await POST(
      request({ ...RECORD_TYPES_BODY, kind: 'async_tasks', jobId: 'job-1' }),
      {}
    )

    expect(response.status).toBe(502)
    expect(await json(response)).toEqual({
      error: 'NetSuite returned an invalid object-discovery response.',
    })
  })

  it('maps unexpected discovery failures to the generic route error', async () => {
    mockListRecordTypes.mockRejectedValueOnce(new Error('secret provider detail'))

    const response = await POST(request(RECORD_TYPES_BODY), {})
    const body = await json(response)

    expect(response.status).toBe(500)
    expect(body.error).toBe('Internal server error')
    expect(JSON.stringify(body)).not.toContain('secret provider detail')
  })

  it('rejects malformed task relationships and collections above the provider ceiling', async () => {
    const taskItems = Array.from({ length: 101 }, (_, index) => ({
      links: [
        {
          rel: 'self',
          href: `/services/rest/async/v1/job/job-1/task/task-${index}`,
        },
      ],
    }))
    for (const items of [
      [{ links: [{ rel: 'alternate', href: taskItems[0].links[0].href }] }],
      taskItems,
      [{ links: 'not-an-array' }],
    ]) {
      mockGetAsyncStatus.mockResolvedValueOnce(success({ items }))
      const response = await POST(
        request({ ...RECORD_TYPES_BODY, kind: 'async_tasks', jobId: 'job-1' }),
        {}
      )
      expect(response.status).toBe(502)
    }
  })

  it('applies the async-task ceiling after duplicate task links are removed', async () => {
    const href = '/services/rest/async/v1/job/job-1/task/task-1'
    mockGetAsyncStatus.mockResolvedValueOnce(
      success({
        items: Array.from({ length: 101 }, () => ({ links: [{ rel: 'self', href }] })),
      })
    )

    const response = await POST(
      request({ ...RECORD_TYPES_BODY, kind: 'async_tasks', jobId: 'job-1' }),
      {}
    )

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      objects: [{ id: 'task-1', label: 'task-1', detail: null }],
    })
  })

  it.each([
    [401, 401, true],
    [403, 403, undefined],
    [404, 400, undefined],
    [500, 502, undefined],
    [undefined, 502, undefined],
  ])(
    'maps provider status %s without reflecting its error',
    async (providerStatus, status, authRequired) => {
      mockListRecordTypes.mockResolvedValueOnce(failure(providerStatus))

      const response = await POST(request(RECORD_TYPES_BODY), {})
      const body = await json(response)

      expect(response.status).toBe(status)
      expect(body.authRequired).toBe(authRequired)
      expect(JSON.stringify(body)).not.toContain('provider secret')
    }
  )

  it.each([
    [new TokenServiceAccountValidationError('invalid_credentials', 401), 401, true],
    [new TokenServiceAccountValidationError('provider_unavailable', 502), 502, undefined],
    [null, 401, true],
  ])(
    'maps credential resolution failures without exposing details',
    async (error, status, authRequired) => {
      if (error === null) {
        mockResolveCredentialAccessToken.mockResolvedValueOnce(null)
      } else {
        mockResolveCredentialAccessToken.mockRejectedValueOnce(error)
      }

      const response = await POST(request(RECORD_TYPES_BODY), {})
      const body = await json(response)

      expect(response.status).toBe(status)
      expect(body.authRequired).toBe(authRequired)
    }
  )

  it.each([
    ['missing access token', { instanceUrl: ORIGIN }],
    ['missing instance URL', { accessToken: 'short-lived-token' }],
  ])('rejects a resolved credential with %s', async (_label, token) => {
    mockResolveCredentialAccessToken.mockResolvedValueOnce(token)

    const response = await POST(request(RECORD_TYPES_BODY), {})

    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({ authRequired: true })
    expect(mockListRecordTypes).not.toHaveBeenCalled()
  })

  it('returns 499 when the caller cancels after provider dispatch', async () => {
    const controller = new AbortController()
    mockListRecordTypes.mockImplementationOnce(async () => {
      controller.abort()
      return success({ items: [{ name: 'customer' }] })
    })

    const response = await POST(request(RECORD_TYPES_BODY, controller.signal), {})

    expect(response.status).toBe(499)
  })
})
