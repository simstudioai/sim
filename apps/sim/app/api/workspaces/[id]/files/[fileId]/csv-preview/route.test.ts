/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSlice: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock('@/lib/file-parsers/csv-preview-slice', () => ({
  getCsvPreviewSlice: mocks.getSlice,
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-record', () => ({
  readWorkspaceFileContentRecord: {
    operation: { id: 'files.read_content', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.readFile,
  },
}))

import { GET } from '@/app/api/workspaces/[id]/files/[fileId]/csv-preview/route'

const WORKSPACE_ID = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const FILE_ID = 'wf_csv'
const KEY = `workspace/${WORKSPACE_ID}/large.csv`
const USER = { id: 'user-1' }
const context = { params: Promise.resolve({ id: WORKSPACE_ID, fileId: FILE_ID }) }

function request(): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}/csv-preview?key=${encodeURIComponent(KEY)}`
  )
}

describe('GET /api/workspaces/[id]/files/[fileId]/csv-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: USER, session: { id: 'session-1' } })
    mocks.readFile.mockResolvedValue({ file: { id: FILE_ID, key: KEY } })
    mocks.getSlice.mockResolvedValue({
      headers: ['name'],
      rows: [['Ada']],
      truncated: false,
    })
  })

  it('propagates client cancellation to the storage preview read', async () => {
    const req = request()
    const response = await GET(req, context)

    expect(response.status).toBe(200)
    expect(mocks.getSlice).toHaveBeenCalledWith({
      key: KEY,
      context: 'workspace',
      signal: req.signal,
    })
  })
})
