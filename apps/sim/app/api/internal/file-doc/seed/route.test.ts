import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckInternalApiKey, mockBuildFileDocSeed } = vi.hoisted(() => ({
  mockCheckInternalApiKey: vi.fn(),
  mockBuildFileDocSeed: vi.fn(),
}))

vi.mock('@/lib/mothership/request/http', () => ({
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
    mockCheckInternalApiKey.mockReturnValue({ success: true })
  })

  /** The relay authenticates with the shared internal API key, not a Bearer JWT. */
  it('401s when the internal api key is rejected, without building a seed', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: false })
    const res = await POST(seedRequest({ workspaceId: 'ws-1', fileId: 'file-1' }))
    expect(res.status).toBe(401)
    expect(mockBuildFileDocSeed).not.toHaveBeenCalled()
  })
})
