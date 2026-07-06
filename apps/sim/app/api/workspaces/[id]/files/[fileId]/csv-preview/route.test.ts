/**
 * Tests for the workspace CSV preview route. Pins the regression where the
 * route resolved files via getWorkspaceFile (context='workspace' only), so a
 * chat-scoped CSV output — resolvable by the same panel that opens the tab —
 * permanently 404'd in CsvTablePreview.
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockGetUserEntityPermissions,
  mockGetPreviewable,
  mockGetCsvPreviewSlice,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetPreviewable: vi.fn(),
  mockGetCsvPreviewSlice: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getPreviewableWorkspaceFile: mockGetPreviewable,
}))

vi.mock('@/lib/file-parsers/csv-preview-slice', () => ({
  getCsvPreviewSlice: mockGetCsvPreviewSlice,
}))

import { GET } from './route'

const OUTPUT_KEY = 'chat/chat-1/data.csv'
const SLICE = { headers: ['a'], rows: [['1']], truncated: false }

function createRequest(key: string) {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/ws-1/files/wf_output/csv-preview?key=${encodeURIComponent(key)}`
  )
}

const routeContext = () => ({ params: Promise.resolve({ id: 'ws-1', fileId: 'wf_output' }) })

describe('GET /api/workspaces/[id]/files/[fileId]/csv-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockGetCsvPreviewSlice.mockResolvedValue(SLICE)
  })

  it('serves a chat-scoped CSV output from its own storage context', async () => {
    mockGetPreviewable.mockResolvedValue({
      id: 'wf_output',
      key: OUTPUT_KEY,
      storageContext: 'output',
    })

    const response = await GET(createRequest(OUTPUT_KEY), routeContext())

    expect(response.status).toBe(200)
    expect(mockGetPreviewable).toHaveBeenCalledWith('ws-1', 'wf_output', 'user-1')
    expect(mockGetCsvPreviewSlice).toHaveBeenCalledWith(
      expect.objectContaining({ key: OUTPUT_KEY, context: 'output' })
    )
  })

  it('serves a workspace CSV with the workspace context', async () => {
    mockGetPreviewable.mockResolvedValue({
      id: 'wf_output',
      key: OUTPUT_KEY,
      storageContext: 'workspace',
    })

    const response = await GET(createRequest(OUTPUT_KEY), routeContext())

    expect(response.status).toBe(200)
    expect(mockGetCsvPreviewSlice).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'workspace' })
    )
  })

  it('404s when the previewable lookup denies or misses (non-owner output, deleted file)', async () => {
    mockGetPreviewable.mockResolvedValue(null)

    const response = await GET(createRequest(OUTPUT_KEY), routeContext())

    expect(response.status).toBe(404)
    expect(mockGetCsvPreviewSlice).not.toHaveBeenCalled()
  })

  it('404s when the client-supplied key does not match the record', async () => {
    mockGetPreviewable.mockResolvedValue({
      id: 'wf_output',
      key: OUTPUT_KEY,
      storageContext: 'output',
    })

    const response = await GET(createRequest('some/other/key.csv'), routeContext())

    expect(response.status).toBe(404)
    expect(mockGetCsvPreviewSlice).not.toHaveBeenCalled()
  })
})
