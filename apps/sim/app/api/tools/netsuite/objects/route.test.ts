/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const mocks = vi.hoisted(() => ({
  checkSessionOrInternalAuth: vi.fn(),
  authorizeCredentialUse: vi.fn(),
  resolveOAuthAccountId: vi.fn(),
  resolveCredentialAccessToken: vi.fn(),
  listRecordTypes: vi.fn(),
  listDatasets: vi.fn(),
  getAsyncStatus: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mocks.checkSessionOrInternalAuth,
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mocks.authorizeCredentialUse,
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: mocks.resolveOAuthAccountId,
  resolveCredentialAccessToken: mocks.resolveCredentialAccessToken,
}))

vi.mock('@/tools/netsuite/list_record_types', () => ({
  netsuiteListRecordTypesTool: { directExecution: mocks.listRecordTypes },
}))

vi.mock('@/tools/netsuite/list_datasets', () => ({
  netsuiteListDatasetsTool: { directExecution: mocks.listDatasets },
}))

vi.mock('@/tools/netsuite/get_async_status', () => ({
  netsuiteGetAsyncStatusTool: { directExecution: mocks.getAsyncStatus },
}))

import { POST } from '@/app/api/tools/netsuite/objects/route'

const suiteTalkOrigin = 'https://123456.suitetalk.api.netsuite.com'
const validBody = {
  credential: 'cred-1',
  workflowId: 'wf-1',
  kind: 'record_types',
} as const

function request(
  body: unknown,
  options: { headers?: HeadersInit; signal?: AbortSignal } = {}
): NextRequest {
  return new NextRequest('http://localhost/api/tools/netsuite/objects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: options.signal,
  })
}

function success(data: unknown, status = 200) {
  return { success: true, output: { status, data } }
}

function failure(status: number, error = 'provider detail must not escape') {
  return { success: false, output: { status, data: null }, error }
}

describe('POST /api/tools/netsuite/objects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mocks.authorizeCredentialUse.mockResolvedValue({
      ok: true,
      credentialOwnerUserId: 'user-1',
      resolvedCredentialId: 'cred-1',
      credentialType: 'service_account',
    })
    mocks.resolveOAuthAccountId.mockResolvedValue({
      accountId: '',
      credentialId: 'cred-1',
      credentialType: 'service_account',
      providerId: 'netsuite-service-account',
      usedCredentialTable: true,
    })
    mocks.resolveCredentialAccessToken.mockResolvedValue({
      accessToken: 'short-lived-token',
      instanceUrl: suiteTalkOrigin,
    })
    mocks.listRecordTypes.mockResolvedValue(
      success({ links: [], items: [{ name: 'customer', links: [] }] })
    )
    mocks.listDatasets.mockResolvedValue(
      success({ links: [], items: [], count: 0, hasMore: false, offset: 0, totalResults: 0 })
    )
    mocks.getAsyncStatus.mockResolvedValue(success({ count: 0, items: [], links: [] }))
  })

  it('authenticates before parsing and rejects external API keys', async () => {
    mocks.checkSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })
    const unauthenticated = await POST(request('{not-json'))

    expect(unauthenticated.status).toBe(401)
    await expect(unauthenticated.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(mocks.authorizeCredentialUse).not.toHaveBeenCalled()

    mocks.checkSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'API key access not allowed for this endpoint',
    })
    const apiKey = await POST(request(validBody, { headers: { 'x-api-key': 'workspace-key' } }))
    expect(apiKey.status).toBe(401)
    await expect(apiKey.json()).resolves.toMatchObject({
      error: 'API key access not allowed for this endpoint',
    })
    expect(mocks.authorizeCredentialUse).not.toHaveBeenCalled()
  })

  it('authorizes trusted internal callers using their verified subject', async () => {
    mocks.checkSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'internal-user',
      authType: 'internal_jwt',
    })

    const response = await POST(request(validBody))

    expect(response.status).toBe(200)
    expect(mocks.authorizeCredentialUse).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        credentialId: 'cred-1',
        workflowId: 'wf-1',
        callerUserId: 'internal-user',
      })
    )
  })

  it('validates JSON, selector dependencies, strict fields, and the 16 KiB body limit', async () => {
    const invalidJson = await POST(request('{not-json'))
    expect(invalidJson.status).toBe(400)

    const missingJob = await POST(
      request({ credential: 'cred-1', workflowId: 'wf-1', kind: 'async_tasks' })
    )
    expect(missingJob.status).toBe(400)

    const unexpectedJob = await POST(request({ ...validBody, jobId: 'job-1' }))
    expect(unexpectedJob.status).toBe(400)

    const overlongCredential = await POST(request({ ...validBody, credential: 'x'.repeat(129) }))
    expect(overlongCredential.status).toBe(400)

    const oversized = await POST(request({ ...validBody, padding: 'x'.repeat(17 * 1024) }))
    expect(oversized.status).toBe(413)
    expect(mocks.authorizeCredentialUse).not.toHaveBeenCalled()
  })

  it('authorizes the selected credential in the workflow before resolving it', async () => {
    mocks.authorizeCredentialUse.mockResolvedValueOnce({
      ok: false,
      error: 'Credential is not accessible from this workflow workspace',
    })

    const response = await POST(request(validBody))

    expect(response.status).toBe(403)
    expect(mocks.authorizeCredentialUse).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        credentialId: 'cred-1',
        workflowId: 'wf-1',
        callerUserId: 'user-1',
      })
    )
    expect(mocks.resolveOAuthAccountId).not.toHaveBeenCalled()
    expect(mocks.resolveCredentialAccessToken).not.toHaveBeenCalled()
  })

  it('requires the exact NetSuite client-credential provider', async () => {
    mocks.authorizeCredentialUse.mockResolvedValueOnce({
      ok: true,
      credentialOwnerUserId: 'user-1',
      resolvedCredentialId: 'oauth-1',
      credentialType: 'oauth',
    })
    const wrongType = await POST(request(validBody))
    expect(wrongType.status).toBe(400)
    expect(mocks.resolveCredentialAccessToken).not.toHaveBeenCalled()

    mocks.resolveOAuthAccountId.mockResolvedValueOnce({
      accountId: '',
      credentialId: 'cred-1',
      credentialType: 'service_account',
      providerId: 'snowflake-service-account',
      usedCredentialTable: true,
    })
    const wrongProvider = await POST(request(validBody))
    expect(wrongProvider.status).toBe(400)
    await expect(wrongProvider.json()).resolves.toMatchObject({
      error: 'Select a NetSuite client-credentials service account.',
    })
    expect(mocks.resolveCredentialAccessToken).not.toHaveBeenCalled()
  })

  it('maps missing and rejected credentials to reconnectable responses', async () => {
    mocks.resolveCredentialAccessToken.mockResolvedValueOnce(null)
    const missing = await POST(request(validBody))
    expect(missing.status).toBe(401)
    await expect(missing.json()).resolves.toMatchObject({ authRequired: true })

    mocks.resolveCredentialAccessToken.mockRejectedValueOnce(
      new TokenServiceAccountValidationError('invalid_credentials', 401)
    )
    const rejected = await POST(request(validBody))
    expect(rejected.status).toBe(401)
    await expect(rejected.json()).resolves.toMatchObject({ authRequired: true })

    mocks.resolveCredentialAccessToken.mockRejectedValueOnce(
      new TokenServiceAccountValidationError('site_not_found', 400)
    )
    const invalidSite = await POST(request(validBody))
    expect(invalidSite.status).toBe(401)
    await expect(invalidSite.json()).resolves.toMatchObject({ authRequired: true })
  })

  it('distinguishes credential-provider outages and unexpected infrastructure failures', async () => {
    mocks.resolveCredentialAccessToken.mockRejectedValueOnce(
      new TokenServiceAccountValidationError('provider_unavailable', 503)
    )
    const unavailable = await POST(request(validBody))
    expect(unavailable.status).toBe(502)
    await expect(unavailable.json()).resolves.toEqual({
      error: 'The NetSuite credential service is temporarily unavailable.',
    })

    mocks.resolveCredentialAccessToken.mockRejectedValueOnce(
      new Error('database connection private detail')
    )
    const infrastructure = await POST(request(validBody))
    expect(infrastructure.status).toBe(500)
    const body = await infrastructure.text()
    expect(body).toContain('Internal server error')
    expect(body).not.toContain('database connection private detail')
  })

  it('injects only the resolved token and SuiteTalk origin into record-type discovery', async () => {
    const req = request(validBody)
    const response = await POST(req)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      objects: [{ id: 'customer', label: 'customer', detail: null }],
    })
    expect(mocks.resolveCredentialAccessToken).toHaveBeenCalledWith(
      'cred-1',
      'user-1',
      expect.any(String)
    )
    expect(mocks.listRecordTypes).toHaveBeenCalledWith(
      {
        oauthCredential: 'cred-1',
        accessToken: 'short-lived-token',
        instanceUrl: suiteTalkOrigin,
      },
      req.signal
    )
    const serializedCalls = JSON.stringify(mocks.listRecordTypes.mock.calls)
    for (const secretField of ['privateKey', 'certificateId', 'clientId']) {
      expect(serializedCalls).not.toContain(secretField)
    }
  })

  it('normalizes, deduplicates, sorts, and caps record types', async () => {
    const items = Array.from({ length: 1_001 }, (_, index) => ({
      name: `type-${String(index).padStart(4, '0')}`,
      links: [],
    }))
    items.push({ name: 'type-0001', links: [] })
    mocks.listRecordTypes.mockResolvedValue(success({ links: [], items: items.reverse() }))

    const response = await POST(request(validBody))
    const body = (await response.json()) as { objects: Array<{ id: string }> }

    expect(response.status).toBe(200)
    expect(body.objects).toHaveLength(1_000)
    expect(body.objects[0]?.id).toBe('type-0000')
    expect(body.objects.at(-1)?.id).toBe('type-0999')
  })

  it('dispatches dataset discovery and preserves distinct IDs, labels, and bounded details', async () => {
    mocks.listDatasets.mockResolvedValue(
      success({
        links: [],
        items: [
          {
            id: 42,
            name: 'Orders',
            description: 'Open orders',
            recordType: { name: 'salesOrder' },
          },
          { id: '7', name: 'Accounts', description: '', recordType: 'customer' },
          { id: 42, name: 'Duplicate', description: 'ignored' },
        ],
        count: 3,
        hasMore: false,
        offset: 0,
        totalResults: 3,
      })
    )
    const req = request({ credential: 'cred-1', workflowId: 'wf-1', kind: 'datasets' })

    const response = await POST(req)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      objects: [
        { id: '7', label: 'Accounts', detail: 'Record type: customer' },
        { id: '42', label: 'Orders', detail: 'Open orders · Record type: salesOrder' },
      ],
    })
    expect(mocks.listDatasets).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthCredential: 'cred-1',
        limit: 1_000,
        offset: 0,
      }),
      req.signal
    )
  })

  it('fails closed on malformed provider envelopes and dataset overflow', async () => {
    mocks.listRecordTypes.mockResolvedValueOnce(success({ items: 'not-an-array' }))
    const malformed = await POST(request(validBody))
    expect(malformed.status).toBe(502)

    mocks.listDatasets.mockResolvedValueOnce(
      success({
        items: Array.from({ length: 1_001 }, (_, index) => ({
          id: String(index),
          name: `Dataset ${index}`,
        })),
      })
    )
    const overflow = await POST(
      request({ credential: 'cred-1', workflowId: 'wf-1', kind: 'datasets' })
    )
    expect(overflow.status).toBe(502)
  })

  it('dispatches async discovery and accepts exact relative or absolute task links', async () => {
    mocks.getAsyncStatus.mockResolvedValue(
      success({
        count: 3,
        items: [
          {
            links: [
              { rel: 'self', href: '/services/rest/async/v1/job/job-7/task/task-b' },
              {
                rel: 'self',
                href: `${suiteTalkOrigin}/services/rest/async/v1/job/job-7/task/task-a`,
              },
            ],
          },
          {
            links: [{ rel: 'self', href: '/services/rest/async/v1/job/job-7/task/task-a' }],
          },
        ],
        links: [],
      })
    )
    const req = request({
      credential: 'cred-1',
      workflowId: 'wf-1',
      kind: 'async_tasks',
      jobId: ' job-7 ',
    })

    const response = await POST(req)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      objects: [
        { id: 'task-a', label: 'task-a', detail: null },
        { id: 'task-b', label: 'task-b', detail: null },
      ],
    })
    expect(mocks.getAsyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthCredential: 'cred-1',
        jobId: 'job-7',
        view: 'tasks',
      }),
      req.signal
    )
  })

  it.each([
    {
      name: 'foreign origin',
      rel: 'self',
      href: 'https://evil.example/services/rest/async/v1/job/job-7/task/task-a',
    },
    { name: 'malformed URL', rel: 'self', href: 'https://[malformed' },
    {
      name: 'another job',
      rel: 'self',
      href: '/services/rest/async/v1/job/other-job/task/task-a',
    },
    {
      name: 'malformed encoding',
      rel: 'self',
      href: '/services/rest/async/v1/job/job%ZZ/task/task-a',
    },
    {
      name: 'query string',
      rel: 'self',
      href: '/services/rest/async/v1/job/job-7/task/task-a?token=secret',
    },
    {
      name: 'fragment',
      rel: 'self',
      href: '/services/rest/async/v1/job/job-7/task/task-a#fragment',
    },
    {
      name: 'wrong path',
      rel: 'self',
      href: '/services/rest/async/v1/job/job-7/not-task/task-a',
    },
    {
      name: 'noncanonical path',
      rel: 'self',
      href: '/services/rest/async/v1/job/extra/../job-7/task/task-a',
    },
    {
      name: 'non-self relationship',
      rel: 'related',
      href: '/services/rest/async/v1/job/job-7/task/task-a',
    },
  ])('rejects an unsafe async task link: $name', async ({ rel, href }) => {
    mocks.getAsyncStatus.mockResolvedValue(
      success({ count: 1, items: [{ links: [{ rel, href }] }], links: [] })
    )

    const response = await POST(
      request({ credential: 'cred-1', workflowId: 'wf-1', kind: 'async_tasks', jobId: 'job-7' })
    )

    expect(response.status).toBe(502)
    const body = await response.text()
    expect(body).not.toContain(href)
  })

  it('rejects async task collections above the 100-link ceiling', async () => {
    mocks.getAsyncStatus.mockResolvedValue(
      success({
        items: [
          {
            links: Array.from({ length: 101 }, (_, index) => ({
              rel: 'self',
              href: `/services/rest/async/v1/job/job-7/task/task-${index}`,
            })),
          },
        ],
      })
    )

    const response = await POST(
      request({ credential: 'cred-1', workflowId: 'wf-1', kind: 'async_tasks', jobId: 'job-7' })
    )

    expect(response.status).toBe(502)
  })

  it.each([
    { providerStatus: 401, routeStatus: 401, authRequired: true },
    { providerStatus: 403, routeStatus: 400, authRequired: false },
    { providerStatus: 404, routeStatus: 400, authRequired: false },
    { providerStatus: 500, routeStatus: 502, authRequired: false },
    { providerStatus: 0, routeStatus: 502, authRequired: false },
  ])(
    'maps provider HTTP $providerStatus to route HTTP $routeStatus without reflecting details',
    async ({ providerStatus, routeStatus, authRequired }) => {
      mocks.listRecordTypes.mockResolvedValue(
        failure(providerStatus, 'short-lived-token raw-client-id private-key-detail')
      )

      const response = await POST(request(validBody))
      const body = await response.text()

      expect(response.status).toBe(routeStatus)
      expect(body).not.toContain('short-lived-token')
      expect(body).not.toContain('raw-client-id')
      expect(body).not.toContain('private-key-detail')
      if (authRequired) expect(JSON.parse(body)).toMatchObject({ authRequired: true })
    }
  )

  it('forwards cancellation to discovery and preserves the route-level 499 response', async () => {
    const cancelledBeforeMint = new AbortController()
    cancelledBeforeMint.abort(new DOMException('cancelled before mint', 'AbortError'))
    const preCancelled = await POST(request(validBody, { signal: cancelledBeforeMint.signal }))
    expect(preCancelled.status).toBe(499)
    expect(mocks.resolveCredentialAccessToken).not.toHaveBeenCalled()
    expect(mocks.listRecordTypes).not.toHaveBeenCalled()

    const cancelledDuringDiscovery = new AbortController()
    mocks.listRecordTypes.mockImplementationOnce(async (_params, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false)
      cancelledDuringDiscovery.abort(new DOMException('cancelled during discovery', 'AbortError'))
      return failure(0)
    })
    const inFlight = await POST(request(validBody, { signal: cancelledDuringDiscovery.signal }))
    expect(inFlight.status).toBe(499)
  })

  it('keeps unexpected tool failures generic', async () => {
    mocks.listRecordTypes.mockRejectedValueOnce(new Error('private programming detail'))

    const response = await POST(request(validBody))
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(body).toContain('Internal server error')
    expect(body).not.toContain('private programming detail')
  })
})
