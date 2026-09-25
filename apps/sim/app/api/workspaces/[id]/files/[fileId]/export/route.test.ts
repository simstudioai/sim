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
import { POST } from '@/app/api/workspaces/[id]/files/[fileId]/export/route'

const WORKSPACE_ID = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const FILE_ID = 'wf_document'
const context = { params: Promise.resolve({ id: WORKSPACE_ID, fileId: FILE_ID }) }

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

  it('rejects an oversized declared request before dispatch', async () => {
    const response = await POST(request({ content: 'x' }, 11 * 1024 * 1024), context)
    expect(response.status).toBe(413)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

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
})
