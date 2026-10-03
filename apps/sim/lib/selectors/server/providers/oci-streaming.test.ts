/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), prepare: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociStreamingSelectorAttachments } from '@/lib/selectors/server/providers/oci-streaming'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const pool = {
  id: 'pool-1',
  name: 'Events',
  compartmentId: 'compartment-1',
  lifecycleState: 'ACTIVE',
  timeCreated: '2026-01-01T00:00:00Z',
  isPrivate: false,
  kafkaSettings: {},
  customEncryptionKey: {},
  endpointFqdn: 'not-an-option.example.com',
  freeformTags: { privateNote: 'not-an-option' },
}
const stream = {
  id: 'stream-1',
  name: 'Orders',
  compartmentId: 'compartment-1',
  streamPoolId: 'pool-1',
  partitions: 2,
  lifecycleState: 'ACTIVE',
  timeCreated: '2026-01-01T00:00:00Z',
  retentionInHours: 24,
  messagesEndpoint: 'https://cell-1.streaming.us-ashburn-1.oci.oraclecloud.com',
}

function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci_streaming.streamPools',
    context: { compartmentId: 'compartment-1', ociRegion: 'us-ashburn-1' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    credential: {
      suppliedId: 'supplied',
      providerId: 'oci-api-key-service-account',
      access: {
        ok: true,
        credentialType: 'service_account',
        resolvedCredentialId: 'resolved',
        workspaceId: 'workspace-1',
      },
    },
    ...overrides,
  }
}

async function execute(input: ExecuteServerSelectorArgs) {
  const attachment =
    ociStreamingSelectorAttachments[
      input.selectorKey as keyof typeof ociStreamingSelectorAttachments
    ]
  if (typeof attachment.destination === 'string') throw new Error('Expected prepared destination')
  const prepared = await attachment.destination.prepare(input)
  return attachment.execute(input, prepared)
}

describe('OCI Streaming selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({ prepareStaticEndpoint: mocks.prepare, request: mocks.request })
    mocks.prepare.mockResolvedValue({
      origin: 'https://streaming.us-ashburn-1.oci.oraclecloud.com',
    })
  })

  it('uses the resolved credential and projects only bounded safe pool metadata', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      headers: { 'opc-next-page': 'page-2' },
      body: new TextEncoder().encode(JSON.stringify([pool])),
    })
    const result = await execute(args({ request: { kind: 'list', cursor: 'page-1' } }))
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved',
      workspaceId: 'workspace-1',
      serviceId: 'oci-streaming',
      region: 'us-ashburn-1',
    })
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual([
      ['compartmentId', 'compartment-1'],
      ['limit', '50'],
      ['page', 'page-1'],
    ])
    expect(result).toEqual({
      kind: 'list',
      nextCursor: 'page-2',
      items: [
        { id: 'pool-1', label: 'Events', meta: { lifecycleState: 'ACTIVE', isPrivate: false } },
      ],
    })
  })

  it('lists streams by the selected pool without adding a compartment filter', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(JSON.stringify([stream])),
    })
    const result = await execute(
      args({ selectorKey: 'oci_streaming.streams', context: { streamPoolId: 'pool-1' } })
    )
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual([
      ['streamPoolId', 'pool-1'],
      ['limit', '50'],
    ])
    expect(result).toEqual({
      kind: 'list',
      items: [
        { id: 'stream-1', label: 'Orders', meta: { lifecycleState: 'ACTIVE', partitions: 2 } },
      ],
    })
  })

  it.each([
    ['oci_streaming.streamPools', { compartmentId: 'another-compartment' }, pool, 'pool-1'],
    ['oci_streaming.streams', { streamPoolId: 'another-pool' }, stream, 'stream-1'],
  ] as const)(
    'does not hydrate an out-of-scope resource for %s',
    async (selectorKey, context, resource, id) => {
      mocks.request.mockResolvedValue({
        status: 200,
        headers: {},
        body: new TextEncoder().encode(JSON.stringify(resource)),
      })
      expect(
        await execute(args({ selectorKey, context, request: { kind: 'detail', id } }))
      ).toEqual({ kind: 'detail', item: null })
    }
  )

  it('rejects provider pages containing resources outside the requested scope', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      headers: {},
      body: new TextEncoder().encode(JSON.stringify([{ ...pool, compartmentId: 'other' }])),
    })
    await expect(execute(args())).rejects.toThrow()
  })

  it('does not prepare credentials after an already canceled selector request', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Canceled', 'AbortError'))
    await expect(execute(args({ signal: controller.signal }))).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
