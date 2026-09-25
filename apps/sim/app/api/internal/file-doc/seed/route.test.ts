import { createMockRequest } from '@sim/testing'
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing/mocks/copilot-http.mock'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildFileDocSeed } = vi.hoisted(() => ({
  mockBuildFileDocSeed: vi.fn(),
}))

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

vi.mock('@/lib/collab-doc/seed', () => ({
  buildFileDocSeed: mockBuildFileDocSeed,
}))

import { POST } from '@/app/api/internal/file-doc/seed/route'

const { mockCheckInternalApiKey } = copilotHttpMockFns
copilotHttpMockFns.mockCreateUnauthorizedResponse.mockImplementation(() =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
)

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
