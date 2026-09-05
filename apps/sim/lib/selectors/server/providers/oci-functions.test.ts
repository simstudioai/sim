/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), prepare: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))

import { OciClientError } from '@/lib/internal/oci/errors'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociFunctionsSelectorAttachments } from '@/lib/selectors/server/providers/oci-functions'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci-functions.applications',
    context: {
      oauthCredential: 'supplied-id',
      compartmentId: 'compartment-1',
      ociRegion: 'credential',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: {
      suppliedId: 'supplied-id',
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      access: {
        ok: true,
        resolvedCredentialId: 'resolved-id',
        credentialType: 'service_account',
        workspaceId: 'workspace-1',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}
async function execute(input: ExecuteServerSelectorArgs) {
  const key = input.selectorKey as keyof typeof ociFunctionsSelectorAttachments
  const attachment = ociFunctionsSelectorAttachments[key]
  if (typeof attachment.destination === 'string') throw new Error('Expected prepared destination')
  return attachment.execute(input, await attachment.destination.prepare(input))
}
function response(body: unknown, headers = {}) {
  return { status: 200, headers, body: new TextEncoder().encode(JSON.stringify(body)) }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.create.mockResolvedValue({ prepareStaticEndpoint: mocks.prepare, request: mocks.request })
  mocks.prepare.mockResolvedValue({ origin: 'management' })
  mocks.request.mockResolvedValue(response([]))
})

describe('OCI Functions server selectors', () => {
  it('binds an authorized service account and trusted workspace before preparing an OCI destination', async () => {
    await execute(args())
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved-id',
      workspaceId: 'workspace-1',
      region: undefined,
      serviceId: 'oci-functions',
    })
  })

  it.each(['foreign-provider', undefined])(
    'rejects an unbound provider %s before preparing the client',
    async (providerId) => {
      const input = args()
      input.credential = { ...input.credential, suppliedId: 'supplied-id', providerId }
      await expect(execute(input)).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it('rejects a mismatched authorized workspace', async () => {
    const input = args()
    input.credential = {
      suppliedId: 'supplied-id',
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      access: {
        ok: true,
        resolvedCredentialId: 'id',
        credentialType: 'service_account',
        workspaceId: 'another',
      },
    }
    await expect(execute(input)).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('requires the discovery scope and keeps list requests to a single page', async () => {
    await expect(execute(args({ context: {} }))).rejects.toBeInstanceOf(
      SelectorContextUnavailableError
    )
    expect(mocks.request).not.toHaveBeenCalled()
    mocks.request.mockResolvedValue(
      response(
        [
          {
            id: 'app-1',
            displayName: 'Orders',
            lifecycleState: 'ACTIVE',
            config: { secret: 'canary' },
          },
        ],
        { 'opc-next-page': 'next-token' }
      )
    )
    const result = await execute(args({ request: { kind: 'list', cursor: 'page-1' } }))
    expect(result).toEqual({
      kind: 'list',
      items: [{ id: 'app-1', label: 'Orders', meta: { lifecycleState: 'ACTIVE' } }],
      nextCursor: 'next-token',
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual([
      ['compartmentId', 'compartment-1'],
      ['limit', '50'],
      ['page', 'page-1'],
    ])
  })

  it('scopes function discovery to its application and propagates region and cancellation', async () => {
    const controller = new AbortController()
    await execute(
      args({
        selectorKey: 'oci-functions.functions',
        context: { applicationId: 'application-1', ociRegion: 'us-phoenix-1' },
        signal: controller.signal,
      })
    )
    expect(mocks.create.mock.calls[0][0].region).toBe('us-phoenix-1')
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      encodedPath: '/20181201/functions',
      queryPairs: [
        ['applicationId', 'application-1'],
        ['limit', '50'],
      ],
      signal: controller.signal,
    })
  })

  it('hydrates a known ID only within the selected scope and projects safe labels', async () => {
    mocks.request.mockResolvedValue(
      response({
        id: 'function-1',
        applicationId: 'application-1',
        displayName: 'Process',
        invokeEndpoint: 'private-canary',
      })
    )
    const input = args({
      selectorKey: 'oci-functions.functions',
      context: { applicationId: 'application-1' },
      request: { kind: 'detail', id: 'function-1' },
    })
    expect(await execute(input)).toEqual({
      kind: 'detail',
      item: { id: 'function-1', label: 'Process', meta: { lifecycleState: null } },
    })
    expect(await execute({ ...input, context: { applicationId: 'another-application' } })).toEqual({
      kind: 'detail',
      item: null,
    })
  })

  it('maps missing details and provider failures without forwarding provider data', async () => {
    mocks.request.mockRejectedValue(new OciClientError('request_failed', { status: 404 }))
    expect(await execute(args({ request: { kind: 'detail', id: 'missing' } }))).toEqual({
      kind: 'detail',
      item: null,
    })
    mocks.request.mockRejectedValue(new OciClientError('request_failed', { status: 403 }))
    await expect(execute(args())).rejects.toEqual(new SelectorConnectionUnavailableError(403))
    mocks.request.mockResolvedValue(response({ secret: 'canary' }))
    await expect(execute(args())).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
  })
})
