/**
 * @vitest-environment node
 */
import { authMockFns } from '@sim/testing'
import { PASTE_LIMITS } from '@sim/utils/paste'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), analytics: vi.fn() }))

vi.mock('@/lib/workspace-files/application/export-workspace-file-snapshot', () => ({
  exportWorkspaceFileSnapshot: {
    operation: { id: 'files.download', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.execute,
  },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.analytics }))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/workspaces/[id]/files/[fileId]/export/route'

const WORKSPACE_ID = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const FILE_ID = 'wf_document'
const context = { params: Promise.resolve({ id: WORKSPACE_ID, fileId: FILE_ID }) }
const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

function request(body: unknown, declaredSize?: number) {
  return new NextRequest(
    `http://localhost/api/workspaces/${WORKSPACE_ID}/files/${FILE_ID}/export`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(declaredSize === undefined ? {} : { 'content-length': String(declaredSize) }),
      },
      body: JSON.stringify(body),
    }
  )
}

describe('POST workspace Markdown snapshot export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.execute.mockResolvedValue({
      file: { id: FILE_ID, workspaceId: WORKSPACE_ID },
      buffer: Buffer.from('new visible text'),
      fileName: 'notes.md',
      contentType: 'text/markdown; charset=utf-8',
      assetCount: 0,
      format: 'markdown',
    })
  })

  it('passes the snapshot to the authorized download operation and returns uncached binary bytes', async () => {
    const req = request({ content: 'new visible text' })
    const response = await POST(req, context)

    expect(mocks.execute).toHaveBeenCalledWith({
      principal,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, content: 'new visible text' },
      request: req,
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('new visible text')
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('content-length')).toBe('16')
    expect(response.headers.get('content-disposition')).toContain('notes.md')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.analytics).toHaveBeenCalledWith(
      'user-1',
      'file_downloaded',
      { workspace_id: WORKSPACE_ID, is_bulk: false, file_count: 1 },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it.each(['', '---\ntitle: 中文 😀\n---\n# Résumé'])(
    'accepts exact empty or Unicode/frontmatter snapshots: %j',
    async (content) => {
      const response = await POST(request({ content }), context)
      expect(response.status).toBe(200)
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ content }) })
      )
    }
  )

  it('authenticates before parsing an oversized body', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const response = await POST(request({ content: 'x' }, 11 * 1024 * 1024), context)
    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.analytics).not.toHaveBeenCalled()
  })

  it('rejects an oversized declared request before dispatch', async () => {
    const response = await POST(request({ content: 'x' }, 11 * 1024 * 1024), context)
    expect(response.status).toBe(413)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([{}, { content: null }, { content: 1 }])(
    'rejects invalid snapshot input %j',
    async (body) => {
      const response = await POST(request(body), context)
      expect(response.status).toBe(400)
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('enforces UTF-8 rather than UTF-16 snapshot size', async () => {
    const content = '😀'.repeat(Math.floor(PASTE_LIMITS.RICH_MARKDOWN_BYTES / 4) + 1)
    const response = await POST(request({ content }), context)
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('conceals cross-tenant access and emits no download analytics', async () => {
    mocks.execute.mockRejectedValue(new NoWorkspaceAccessError())
    const response = await POST(request({ content: 'x' }), context)
    expect(response.status).toBe(404)
    expect(mocks.analytics).not.toHaveBeenCalled()
  })

  it('renders size rejection without logging a successful download', async () => {
    mocks.execute.mockRejectedValue(new OrchestrationError('validation', 'Export limit exceeded'))
    const response = await POST(request({ content: 'x' }), context)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Export limit exceeded' })
    expect(mocks.analytics).not.toHaveBeenCalled()
  })

  it('preserves the ZIP filename and bundle analytics', async () => {
    mocks.execute.mockResolvedValue({
      file: { id: FILE_ID, workspaceId: WORKSPACE_ID },
      buffer: Buffer.from('zip bytes'),
      fileName: 'Résumé.zip',
      contentType: 'application/zip',
      assetCount: 2,
      format: 'zip',
    })
    const response = await POST(request({ content: 'x' }), context)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''R%C3%A9sum%C3%A9.zip"
    )
    expect(mocks.analytics).toHaveBeenCalledWith(
      'user-1',
      'file_downloaded',
      { workspace_id: WORKSPACE_ID, is_bulk: true, file_count: 3 },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })
})
