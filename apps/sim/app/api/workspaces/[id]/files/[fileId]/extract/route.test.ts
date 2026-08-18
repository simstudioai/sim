/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  extract: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/workspace-files/application/extract-workspace-file', () => ({
  extractWorkspaceFile: {
    operation: { id: 'files.extract_archive', minimumRole: 'write', workspaceApiKey: 'deny' },
    execute: mocks.extract,
  },
}))

import { ArchiveError } from '@/lib/uploads/archive'
import { POST } from '@/app/api/workspaces/[id]/files/[fileId]/extract/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID, fileId: FILE_ID }) }

function callExtract() {
  return POST(
    new NextRequest(
      `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}/extract`,
      { method: 'POST' }
    ),
    context
  )
}

describe('POST /api/workspaces/[id]/files/[fileId]/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.extract.mockResolvedValue({ folderName: 'bundle', extractedCount: 2, skippedCount: 0 })
  })

  it('passes a session principal and canonical assertion to the extraction use case', async () => {
    const response = await callExtract()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      folderName: 'bundle',
      extractedCount: 2,
      skippedCount: 0,
    })
    expect(mocks.extract).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })

  it('authenticates before invoking extraction', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await callExtract()

    expect(response.status).toBe(401)
    expect(mocks.extract).not.toHaveBeenCalled()
  })

  it('returns a caller-safe error for an invalid zip', async () => {
    mocks.extract.mockRejectedValue(new ArchiveError('invalid', 'Not a valid .zip archive.'))

    const response = await callExtract()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Not a valid .zip archive.' })
  })
})
