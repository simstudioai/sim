import { createHash } from 'node:crypto'
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admit: vi.fn(), stage: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workspace-source/application/stage-blobs', () => ({
  admitSourceBlobStage: {
    operation: { id: 'workspaces.source.blobs.stage' },
    execute: mocks.admit,
  },
  stageSourceBlobs: { operation: { id: 'workspaces.source.blobs.stage' }, execute: mocks.stage },
}))

import { POST } from '@/app/api/v2/workspaces/[workspaceId]/source/blobs/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-2' },
  rateLimitSubjectIds: ['api-key:key-2'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const context = { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }

/** A staging request carrying one part per buffer, as the CLI builds it. */
async function stagingRequest(buffers: Buffer[]): Promise<NextRequest> {
  const form = new FormData()
  for (const bytes of buffers) {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    form.append(sha256, new Blob([new Uint8Array(bytes)]), sha256)
  }
  const encoded = new Response(form)
  const body = Buffer.from(await encoded.arrayBuffer())
  return new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/source/blobs`, {
    method: 'POST',
    headers: {
      'x-api-key': 'key',
      'content-type': encoded.headers.get('content-type') ?? '',
      'content-length': String(body.byteLength),
    },
    body,
  })
}

describe('POST /api/v2/workspaces/{workspaceId}/source/blobs', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.admit.mockReset().mockResolvedValue({ workspaceId: WORKSPACE_ID })
    mocks.stage.mockReset().mockResolvedValue({ workspaceId: WORKSPACE_ID, staged: [] })
  })

  it('answers a body the proxy would cut off with 413 PAYLOAD_TOO_LARGE naming the limit, before reading it', async () => {
    const response = await POST(
      await stagingRequest([Buffer.alloc(6_000_000, 1), Buffer.alloc(6_000_000, 2)]),
      context
    )

    expect(response.status).toBe(413)
    const { error } = await response.json()
    expect(error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(error.message).toMatch(/at most \d+ bytes; this one carries \d+/)
    expect(mocks.stage).not.toHaveBeenCalled()
  })

  it('stages a single file of the largest size a directory holds', async () => {
    const response = await POST(await stagingRequest([Buffer.alloc(10_000_000, 3)]), context)

    expect(response.status).toBe(200)
    expect(mocks.stage.mock.calls[0][0].input.blobs).toHaveLength(1)
  })
})
