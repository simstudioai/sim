import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const { mockAdmit, mockRead, mockSave } = vi.hoisted(() => ({
  mockAdmit: vi.fn(),
  mockRead: vi.fn(),
  mockSave: vi.fn(),
}))

vi.mock('@/lib/browser-agent/application/browser-file-transfer', () => ({
  admitBrowserDownloadSave: mockAdmit,
  readBrowserUploadFile: {
    operation: { id: 'files.read_content', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mockRead,
  },
  saveBrowserDownload: {
    operation: { id: 'files.create', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mockSave,
  },
}))

import { POST, PUT } from '@/app/api/desktop/tool/file/route'

const mockGetSession = authMockFns.mockGetSession
const URL_BASE = 'http://localhost/api/desktop/tool/file'
const session = { user: { id: 'u1' }, session: { id: 's1' } }
const principal = { kind: 'session', userId: 'u1', sessionId: 's1' }

const post = (body: unknown) =>
  new NextRequest(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const put = (query: string, body: Uint8Array, headers: Record<string, string> = {}) =>
  new NextRequest(`${URL_BASE}?${query}`, {
    method: 'PUT',
    headers: { 'content-length': String(body.byteLength), ...headers },
    body,
  })

describe('/api/desktop/tool/file', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue(session)
    mockAdmit.mockResolvedValue(undefined)
    mockRead.mockResolvedValue({ file: { name: 'Q3 plan.pdf' }, content: Buffer.from('%PDF') })
    mockSave.mockResolvedValue({
      file: { name: 'report.csv', size: 3, folderPath: null, vfsNamespace: 'files' },
    })
  })

  it('authenticates before parsing and conceals an unknown transfer', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    expect((await POST(post({ toolCallId: 'call-1', index: 0 }), {})).status).toBe(401)

    mockRead.mockRejectedValueOnce(new OrchestrationError('not_found', 'File not found'))
    const missing = await POST(post({ toolCallId: 'call-1', index: 0 }), {})
    expect(missing.status).toBe(404)

    expect((await POST(post({ toolCallId: 'call-1', index: 99 }), {})).status).toBe(400)
  })

  it('rejects an unauthenticated or oversized save before reading the body', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    expect((await PUT(put('toolCallId=c&name=a.csv', new Uint8Array(1)))).status).toBe(401)

    const oversized = await PUT(
      put('toolCallId=c&name=a.csv', new Uint8Array(1), { 'content-length': String(2 ** 31) })
    )
    expect(oversized.status).toBe(413)
    expect(mockAdmit).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('refuses an unadmitted save without reading its body', async () => {
    mockAdmit.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Browser file transfer not found')
    )
    const request = put('toolCallId=unknown&name=a.csv', new Uint8Array([1, 2, 3]))

    const res = await PUT(request)

    expect(res.status).toBe(404)
    expect(mockAdmit).toHaveBeenCalledWith(principal, { toolCallId: 'unknown', name: 'a.csv' })
    expect(request.bodyUsed).toBe(false)
    expect(mockSave).not.toHaveBeenCalled()
  })
})
