/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveChatUploadRecord, mockResolveChatOutputRecord, mockResolveWorkspaceFileRef } =
  vi.hoisted(() => ({
    mockResolveChatUploadRecord: vi.fn(),
    mockResolveChatOutputRecord: vi.fn(),
    mockResolveWorkspaceFileRef: vi.fn(),
  }))

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  resolveChatUploadRecord: mockResolveChatUploadRecord,
}))

vi.mock('@/lib/copilot/tools/handlers/output-file-reader', () => ({
  resolveChatOutputRecord: mockResolveChatOutputRecord,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFileRef,
}))

import { resolveToolInputFile } from '@/lib/copilot/tools/server/files/resolve-input-file'

const UPLOAD_RECORD = { id: 'wf_upload', name: 'ref.jpg', storageContext: 'mothership' }
const OUTPUT_RECORD = { id: 'wf_output', name: 'gen.png', storageContext: 'output' }
const WORKSPACE_RECORD = { id: 'wf_shared', name: 'shared.pdf' }

describe('resolveToolInputFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveChatUploadRecord.mockResolvedValue(UPLOAD_RECORD)
    mockResolveChatOutputRecord.mockResolvedValue(OUTPUT_RECORD)
    mockResolveWorkspaceFileRef.mockResolvedValue(WORKSPACE_RECORD)
  })

  it('resolves uploads/<name> through the chat upload resolver', async () => {
    const record = await resolveToolInputFile({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      path: 'uploads/ref.jpg',
    })
    expect(record).toBe(UPLOAD_RECORD)
    expect(mockResolveChatUploadRecord).toHaveBeenCalledWith('chat-1', 'ref.jpg')
    expect(mockResolveWorkspaceFileRef).not.toHaveBeenCalled()
  })

  it('resolves outputs/<name> through the chat output resolver', async () => {
    const record = await resolveToolInputFile({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      path: 'outputs/gen.png',
    })
    expect(record).toBe(OUTPUT_RECORD)
    expect(mockResolveChatOutputRecord).toHaveBeenCalledWith('chat-1', 'gen.png')
  })

  it('ignores a stray trailing segment on the flat chat namespaces', async () => {
    await resolveToolInputFile({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      path: 'uploads/ref.jpg/content',
    })
    expect(mockResolveChatUploadRecord).toHaveBeenCalledWith('chat-1', 'ref.jpg')
  })

  it('returns null for chat-scoped paths without a chat', async () => {
    const upload = await resolveToolInputFile({ workspaceId: 'ws-1', path: 'uploads/ref.jpg' })
    const output = await resolveToolInputFile({ workspaceId: 'ws-1', path: 'outputs/gen.png' })
    expect(upload).toBeNull()
    expect(output).toBeNull()
    expect(mockResolveChatUploadRecord).not.toHaveBeenCalled()
    expect(mockResolveChatOutputRecord).not.toHaveBeenCalled()
  })

  it('falls back to the workspace resolver for files/ paths and wf_ ids', async () => {
    const byPath = await resolveToolInputFile({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      path: 'files/shared.pdf',
    })
    const byId = await resolveToolInputFile({ workspaceId: 'ws-1', path: 'wf_shared' })
    expect(byPath).toBe(WORKSPACE_RECORD)
    expect(byId).toBe(WORKSPACE_RECORD)
    expect(mockResolveWorkspaceFileRef).toHaveBeenCalledWith('ws-1', 'files/shared.pdf')
    expect(mockResolveWorkspaceFileRef).toHaveBeenCalledWith('ws-1', 'wf_shared')
  })
})
