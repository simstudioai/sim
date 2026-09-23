/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAsyncToolCall: vi.fn(),
  getRunSegment: vi.fn(),
  resolveReference: vi.fn(),
  fetchBuffer: vi.fn(),
  loadWorkspace: vi.fn(),
  createFile: vi.fn(),
  resolvePermission: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: { FILE_UPLOADED: 'FILE_UPLOADED' },
  AuditResourceType: { FILE: 'FILE' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getAsyncToolCall: mocks.getAsyncToolCall,
  getRunSegment: mocks.getRunSegment,
}))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveReferencedWorkspaceFileContext: mocks.resolveReference,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchBuffer,
  loadActiveWorkspaceContext: mocks.loadWorkspace,
}))
vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  createAuthorizedWorkspaceFile: mocks.createFile,
  projectCreateWorkspaceFileAudit: (result: { file: { id: string; name: string } }) => ({
    action: 'FILE_UPLOADED',
    resourceType: 'FILE',
    resourceId: result.file.id,
    resourceName: result.file.name,
  }),
}))

import {
  readBrowserUploadFile,
  saveBrowserDownload,
} from '@/lib/browser-agent/application/browser-file-transfer'

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}
const file = { id: 'file-1', name: 'resume.pdf', folderPath: null, vfsNamespace: 'files' }

function claimedCall(toolName: string, args: Record<string, unknown>) {
  return {
    toolCallId: 'call-1',
    runId: 'run-1',
    toolName,
    status: 'running',
    claimedBy: 'desktop-browser',
    args,
  }
}

describe('browser file transfer use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.getRunSegment.mockResolvedValue({
      id: 'run-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    })
    mocks.resolveReference.mockResolvedValue({ ...workspace, fileId: file.id, file })
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('pdf'))
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.createFile.mockResolvedValue({ file: { ...file, id: 'file-2', name: 'report.csv' } })
  })

  it('reads the file the claimed call names, scoped to its run workspace and chat', async () => {
    mocks.getAsyncToolCall.mockResolvedValue(
      claimedCall('browser_upload_file', { paths: ['user-local/x', 'files/resume.pdf'] })
    )

    await expect(
      readBrowserUploadFile.execute({ principal, input: { toolCallId: 'call-1', index: 1 } })
    ).resolves.toEqual({ file, content: Buffer.from('pdf') })

    expect(mocks.resolveReference).toHaveBeenCalledWith(
      principal,
      { workspaceId: 'workspace-1', reference: 'files/resume.pdf', chatId: 'chat-1' },
      { includeChatUploads: true }
    )
  })

  it.each([
    ['another tool', claimedCall('browser_click', { paths: ['files/a'] })],
    [
      'an unclaimed call',
      { ...claimedCall('browser_upload_file', { paths: ['files/a'] }), status: 'pending' },
    ],
    [
      'a call claimed elsewhere',
      {
        ...claimedCall('browser_upload_file', { paths: ['files/a'] }),
        claimedBy: 'desktop-terminal',
      },
    ],
  ])('conceals %s', async (_label, call) => {
    mocks.getAsyncToolCall.mockResolvedValue(call)

    await expect(
      readBrowserUploadFile.execute({ principal, input: { toolCallId: 'call-1', index: 0 } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolveReference).not.toHaveBeenCalled()
  })

  it('refuses another user and local-folder or missing paths', async () => {
    mocks.getAsyncToolCall.mockResolvedValue(
      claimedCall('browser_upload_file', { paths: ['user-local/Docs--m1/a.pdf'] })
    )

    await expect(
      readBrowserUploadFile.execute({ principal, input: { toolCallId: 'call-1', index: 0 } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      readBrowserUploadFile.execute({ principal, input: { toolCallId: 'call-1', index: 3 } })
    ).rejects.toMatchObject({ code: 'not_found' })

    mocks.getRunSegment.mockResolvedValue({
      id: 'run-1',
      userId: 'someone-else',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    })
    await expect(
      readBrowserUploadFile.execute({ principal, input: { toolCallId: 'call-1', index: 0 } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolveReference).not.toHaveBeenCalled()
  })

  it('saves a download under the call name, typed by extension, and audits it', async () => {
    mocks.getAsyncToolCall.mockResolvedValue(
      claimedCall('browser_save_download', { downloadId: 'd1', name: ' report.csv ' })
    )

    const result = await saveBrowserDownload.execute({
      principal,
      input: { toolCallId: 'call-1', name: 'export-9Q2Z.csv', content: Buffer.from('a,b') },
    })

    expect(result.file.name).toBe('report.csv')
    expect(mocks.createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspaceId: 'workspace-1',
          name: 'report.csv',
          contentType: 'text/csv',
          exactName: false,
        },
        content: Buffer.from('a,b'),
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
  })

  it('falls back to the downloaded file name and never saves for an upload call', async () => {
    mocks.getAsyncToolCall.mockResolvedValueOnce(
      claimedCall('browser_save_download', { downloadId: 'd1' })
    )
    await saveBrowserDownload.execute({
      principal,
      input: { toolCallId: 'call-1', name: 'invoice.pdf', content: Buffer.from('%PDF') },
    })
    expect(mocks.createFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ name: 'invoice.pdf' }) })
    )

    mocks.getAsyncToolCall.mockResolvedValueOnce(
      claimedCall('browser_upload_file', { paths: ['files/a'] })
    )
    await expect(
      saveBrowserDownload.execute({
        principal,
        input: { toolCallId: 'call-1', name: 'x.pdf', content: Buffer.from('x') },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.createFile).toHaveBeenCalledTimes(1)
  })
})
