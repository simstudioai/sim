/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateDimensions: vi.fn() }))

vi.mock('@/lib/workspace-files/application/update-workspace-file-dimensions', () => ({
  updateWorkspaceFileDimensionsOperation: {
    operation: { id: 'files.update_metadata', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateDimensions,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PATCH } from '@/app/api/workspaces/[id]/files/[fileId]/dimensions/route'

const WORKSPACE_ID = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const FILE_ID = 'wf_abc123'
const KEY = 'workspace/7727ef3f/screenshot.png'
const USER = { id: 'user-1' }
const PRINCIPAL = { kind: 'session' as const, userId: USER.id, sessionId: 'session-1' }
const context = { params: Promise.resolve({ id: WORKSPACE_ID, fileId: FILE_ID }) }

function request(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}/dimensions`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

describe('PATCH /api/workspaces/[id]/files/[fileId]/dimensions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: USER, session: { id: 'session-1' } })
    mocks.updateDimensions.mockResolvedValue({ success: true })
  })

  it('updates dimensions through the shared operation', async () => {
    const req = request({ key: KEY, width: 1600, height: 900 })
    const response = await PATCH(req, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mocks.updateDimensions).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        fileId: FILE_ID,
        assertedWorkspaceId: WORKSPACE_ID,
        key: KEY,
        width: 1600,
        height: 900,
      },
      request: req,
    })
  })

  it('preserves the stale content-version result', async () => {
    mocks.updateDimensions.mockResolvedValue({ success: false })
    const response = await PATCH(request({ key: KEY, width: 10, height: 20 }), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: false })
  })

  it('authenticates before parsing or dispatching', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await PATCH(request({ key: KEY, width: 10, height: 10 }), context)

    expect(response.status).toBe(401)
    expect(mocks.updateDimensions).not.toHaveBeenCalled()
  })

  it('rejects invalid dimensions after authentication', async () => {
    const response = await PATCH(request({ key: KEY, width: 0, height: 10 }), context)

    expect(response.status).toBe(400)
    expect(mocks.updateDimensions).not.toHaveBeenCalled()
  })

  it('renders typed authorization errors', async () => {
    mocks.updateDimensions.mockRejectedValue(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )
    const response = await PATCH(request({ key: KEY, width: 10, height: 10 }), context)

    expect(response.status).toBe(403)
    expect(mocks.updateDimensions).toHaveBeenCalled()
  })
})
