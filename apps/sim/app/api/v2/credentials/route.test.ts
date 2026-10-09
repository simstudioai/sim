import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/credentials/application/list-workspace-credentials', () => ({
  listWorkspaceCredentials: {
    operation: { id: 'credentials.connections.list' },
    execute: mocks.list,
  },
}))

vi.mock('@/lib/credentials/application/service-account', () => ({
  createServiceAccountCredentialUseCase: {
    operation: { id: 'credentials.service_accounts.create' },
    execute: mocks.create,
  },
}))

import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET, POST } from '@/app/api/v2/credentials/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const credential = {
  id: 'credential-1',
  workspaceId: WORKSPACE_ID,
  type: 'service_account' as const,
  displayName: 'Zoom account',
  description: null,
  providerId: 'zoom-service-account',
  accountId: null,
  envKey: 'MUST_NOT_LEAK',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  hasServiceAccountKey: true,
  role: 'member' as const,
}

describe('GET /api/v2/credentials', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({
      credentials: [credential],
      nextCursorKeys: null,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })
  })

  /**
   * Pins the binding end-to-end — the mint in `present` and the read in
   * `mapInput` — because the contract-level sweep only checks a hand-maintained
   * map of param names and stays green when a route drops the stamp entirely.
   */
  it('refuses a cursor minted under a different filter', async () => {
    mocks.list.mockResolvedValue({
      credentials: [credential],
      nextCursorKeys: ['2026-01-01T00:00:00.000Z', 'credential-1'],
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&search=zoom`
      )
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.list.mockClear()
    const replayed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&search=slack&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('projects credential metadata field by field without secret material', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )
    const body = await response.json()

    expect(body).toEqual({
      data: [
        {
          id: 'credential-1',
          type: 'service_account',
          displayName: 'Zoom account',
          description: null,
          providerId: 'zoom-service-account',
          accountId: null,
          hasServiceAccountKey: true,
          role: 'member',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(JSON.stringify(body)).not.toContain('envKey')
    expect(JSON.stringify(body)).not.toContain('createdBy')
  })
})

describe('POST /api/v2/credentials', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue({
      ...auth,
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      keyType: 'personal',
    })
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.create.mockResolvedValue({
      credential: { ...credential, encryptedServiceAccountKey: 'must-not-leak' },
      created: true,
      hasServiceAccountKey: true,
      role: 'admin',
      auditMetadata: {},
    })
  })

  it('creates a verified service-account credential without returning secrets', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'zoom-service-account',
        displayName: 'Zoom account',
        credentials: JSON.stringify({
          clientId: 'client-id',
          clientSecret: 'client-secret',
          orgId: 'account-id',
        }),
      }),
    })
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data).toMatchObject({
      id: 'credential-1',
      type: 'service_account',
      displayName: 'Zoom account',
      providerId: 'zoom-service-account',
      hasServiceAccountKey: true,
      role: 'admin',
    })
    expect(JSON.stringify(body)).not.toContain('client-secret')
    expect(JSON.stringify(body)).not.toContain('must-not-leak')
    expect(mocks.create).toHaveBeenCalledWith({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: {
        workspaceId: WORKSPACE_ID,
        providerId: 'zoom-service-account',
        displayName: 'Zoom account',
        description: undefined,
        id: undefined,
        serviceAccountJson: undefined,
        apiToken: undefined,
        domain: undefined,
        signingSecret: undefined,
        botToken: undefined,
        clientId: 'client-id',
        clientSecret: 'client-secret',
        orgId: 'account-id',
        dataCenter: undefined,
        authMethod: undefined,
        privateKey: undefined,
        username: undefined,
        tenancyOcid: undefined,
        userOcid: undefined,
        fingerprint: undefined,
        privateKeyPassphrase: undefined,
        region: undefined,
      },
      request,
    })
  })

  it('forwards OCI credential fields from the write-only credentials envelope', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'oci-api-key-service-account',
        credentials: JSON.stringify({
          tenancyOcid: 'ocid1.tenancy.oc1..tenant',
          userOcid: 'ocid1.user.oc1..user',
          fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
          privateKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
          privateKeyPassphrase: ' exact passphrase ',
          region: 'us-ashburn-1',
        }),
      }),
    })
    const response = await POST(request)
    const body = await response.text()

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: expect.objectContaining({
        providerId: 'oci-api-key-service-account',
        tenancyOcid: 'ocid1.tenancy.oc1..tenant',
        userOcid: 'ocid1.user.oc1..user',
        fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
        privateKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
        privateKeyPassphrase: ' exact passphrase ',
        region: 'us-ashburn-1',
      }),
      request,
    })
    expect(body).not.toContain('PRIVATE KEY')
    expect(body).not.toContain('exact passphrase')
  })

  it.each(['multiline wallet', 'maximum-size JSON with escaped whitespace'])(
    'accepts an Oracle connection with %s through the serialized credential envelope',
    async (variant) => {
      const connection = JSON.stringify({
        host: 'database.example.com',
        protocol: 'tcps',
        serviceName: 'database',
        username: 'sim',
        password: 'write-only-password',
        walletContent: `-----BEGIN CERTIFICATE-----\n${`${'A'.repeat(64)}\n`.repeat(4096)}-----END CERTIFICATE-----`,
      })
      const serviceAccountJson =
        variant === 'multiline wallet' ? connection : connection.padEnd(2 * 1024 * 1024, '\n')
      const response = await POST(
        new NextRequest('http://localhost:3000/api/v2/credentials', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId: WORKSPACE_ID,
            type: 'service_account',
            providerId: 'oracledb-service-account',
            credentials: JSON.stringify({ serviceAccountJson }),
          }),
        })
      )

      expect(response.status).toBe(201)
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ serviceAccountJson }) })
      )
      const body = await response.text()
      expect(body).not.toContain('write-only-password')
      expect(body).not.toContain('BEGIN CERTIFICATE')
    }
  )

  it('rejects an oversized Oracle connection at the nested field limit', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'oracledb-service-account',
          credentials: JSON.stringify({
            serviceAccountJson: '{}'.padEnd(2 * 1024 * 1024 + 1, ' '),
          }),
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        details: expect.arrayContaining([
          expect.objectContaining({
            path: ['credentials', 'serviceAccountJson'],
            message: expect.stringContaining('2097152'),
          }),
        ]),
      },
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects excessive serialized envelope padding before credential verification', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'oracledb-service-account',
          credentials: JSON.stringify({ serviceAccountJson: '{}' }).padEnd(
            4 * 1024 * 1024 + 128 * 1024 + 1,
            ' '
          ),
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        details: expect.arrayContaining([expect.objectContaining({ path: ['credentials'] })]),
      },
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  /**
   * `credentials create slack-custom-bot` used to fail twice over: discovery
   * demanded a client-generated id, and a caller who then supplied a slug was
   * refused for not sending a UUID. The id is optional on every provider — the
   * server mints one — while an explicit UUID keeps working for a caller that
   * configured its Slack Request URL ahead of time.
   */
  it('accepts a Slack custom bot without an id and leaves minting to the server', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'slack-custom-bot',
          credentials: JSON.stringify({ signingSecret: 'sign', botToken: 'xoxb-1' }),
        }),
      })
    )

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          providerId: 'slack-custom-bot',
          id: undefined,
          signingSecret: 'sign',
          botToken: 'xoxb-1',
        }),
      })
    )
  })

  it.each([
    ['malformed JSON', '{'],
    ['a JSON array', '[]'],
    ['an unsupported field', JSON.stringify({ extra: 'not-accepted' })],
  ])('rejects credentials containing %s before the use case', async (_label, credentials) => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'zoom-service-account',
          credentials,
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects missing provider fields inside credentials before the use case', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'zoom-service-account',
          credentials: JSON.stringify({ clientId: 'client-id', clientSecret: 'client-secret' }),
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        details: [{ path: ['credentials', 'orgId'] }],
      },
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
