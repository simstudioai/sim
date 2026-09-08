/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckInternalApiKey, mockBuildFileDocSeed } = vi.hoisted(() => ({
  mockCheckInternalApiKey: vi.fn(),
  mockBuildFileDocSeed: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => ({
  checkInternalApiKey: mockCheckInternalApiKey,
  createUnauthorizedResponse: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
}))

vi.mock('@/lib/collab-doc/seed', () => ({
  buildFileDocSeed: mockBuildFileDocSeed,
}))

import { POST } from '@/app/api/internal/file-doc/seed/route'

function seedRequest(body: unknown) {
  return createMockRequest('POST', body, { 'x-api-key': 'internal' })
}

describe('POST /api/internal/file-doc/seed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalApiKey.mockReturnValue({ success: true })
  })

  /** The relay authenticates with the shared internal API key, not a Bearer JWT. */
  it('401s when the internal api key is rejected, without building a seed', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: false })
    const res = await POST(seedRequest({ workspaceId: 'ws-1', fileId: 'file-1' }))
    expect(res.status).toBe(401)
    expect(mockBuildFileDocSeed).not.toHaveBeenCalled()
  })

  it('returns the seed as base64 for an authorized request', async () => {
    mockBuildFileDocSeed.mockResolvedValue({ update: new Uint8Array([1, 2, 3, 4]) })
    const request = seedRequest({ workspaceId: 'ws-1', fileId: 'file-1' })
    const res = await POST(request)
    expect(res.status).toBe(200)
    expect((await res.json()).update).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'))
    expect(mockBuildFileDocSeed).toHaveBeenCalledWith('ws-1', 'file-1', request.signal)
  })

  it('returns update:null for a genuinely absent file', async () => {
    mockBuildFileDocSeed.mockResolvedValue(null)
    const res = await POST(seedRequest({ workspaceId: 'ws-1', fileId: 'missing' }))
    expect(res.status).toBe(200)
    expect((await res.json()).update).toBeNull()
  })

  it('400s on a body missing required fields (contract validation, after auth)', async () => {
    const res = await POST(seedRequest({ workspaceId: 'ws-1' }))
    expect(res.status).toBe(400)
    expect(mockBuildFileDocSeed).not.toHaveBeenCalled()
  })

  it('500s when the seed build throws (a read error the relay should retry)', async () => {
    mockBuildFileDocSeed.mockRejectedValue(new Error('db down'))
    const res = await POST(seedRequest({ workspaceId: 'ws-1', fileId: 'file-1' }))
    expect(res.status).toBe(500)
  })
})
