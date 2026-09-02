/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  buildEmbeddedImageRefWarningMock,
  compileDocForWriteMock,
  waitForLatestFileIntentMock,
  executeCopilotFileUseCaseMock,
  getDocumentFormatInfoMock,
  inferContentTypeMock,
  resolveCopilotFilePrincipalMock,
} = vi.hoisted(() => ({
  buildEmbeddedImageRefWarningMock: vi.fn(),
  compileDocForWriteMock: vi.fn(),
  waitForLatestFileIntentMock: vi.fn(),
  executeCopilotFileUseCaseMock: vi.fn(),
  getDocumentFormatInfoMock: vi.fn(),
  inferContentTypeMock: vi.fn(),
  resolveCopilotFilePrincipalMock: vi.fn(),
}))

vi.mock('@/lib/copilot/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: executeCopilotFileUseCaseMock,
}))
vi.mock('@/lib/copilot/auth/file-delegation', () => ({
  messageForCopilotFileError: vi.fn((_error: unknown, fallback: string) => fallback),
  resolveCopilotFilePrincipal: resolveCopilotFilePrincipalMock,
}))
vi.mock('@/lib/core/config/env-flags', () => ({
  isDocSandboxEnabled: false,
}))
vi.mock('@/lib/workspace-files/application/update-workspace-file-content', () => ({
  updateWorkspaceFileContent: { operation: { id: 'files.update_content' } },
}))
vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  getE2BDocFormat: vi.fn(),
}))
vi.mock('@/lib/copilot/tools/server/files/embedded-image-refs', () => ({
  buildEmbeddedImageRefWarning: buildEmbeddedImageRefWarningMock,
}))
vi.mock('@/lib/copilot/tools/server/files/file-intent-store', () => ({
  waitForLatestFileIntent: waitForLatestFileIntentMock,
}))
vi.mock('@/lib/copilot/tools/server/files/workspace-file', () => ({
  compileDocForWrite: compileDocForWriteMock,
  getDocumentFormatInfo: getDocumentFormatInfoMock,
  inferContentType: inferContentTypeMock,
}))

import { editContentServerTool } from '@/lib/copilot/tools/server/files/edit-content'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'

const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  messageId: 'message-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as const

const workspacePrincipal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-tool:tool-call-1',
  audience: 'sim:workspace-files',
  issuedAt: new Date('2026-08-12T00:00:00.000Z'),
  expiresAt: new Date('2026-08-12T00:05:00.000Z'),
  resourceScope: { chatId: 'chat-1' },
} as const

describe('edit_content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveCopilotFilePrincipalMock.mockReturnValue(workspacePrincipal)
    getDocumentFormatInfoMock.mockReturnValue({ isDoc: true })
    inferContentTypeMock.mockReturnValue('text/x-python-pdf')
    compileDocForWriteMock.mockResolvedValue({ ok: true, sourceMime: 'text/x-python-pdf' })
    executeCopilotFileUseCaseMock.mockResolvedValue({})
    buildEmbeddedImageRefWarningMock.mockResolvedValue('')
    waitForLatestFileIntentMock.mockResolvedValue({
      operation: 'update',
      fileId: 'pdf-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      fileRecord: {
        id: 'pdf-1',
        name: 'report.pdf',
      },
      contentType: 'text/x-python-pdf',
      createdAt: Date.now(),
    })
  })

  it('compiles with workspace scope while keeping the destination write file-scoped', async () => {
    const content = "image = ImageReader('/home/user/inputs/image-1')"

    await expect(editContentServerTool.execute({ content }, context)).resolves.toMatchObject({
      success: true,
    })

    expect(resolveCopilotFilePrincipalMock).toHaveBeenCalledWith(context)
    expect(compileDocForWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: content,
        fileName: 'report.pdf',
        workspaceId: 'workspace-1',
        principal: workspacePrincipal,
      })
    )
    expect(executeCopilotFileUseCaseMock).toHaveBeenCalledWith(
      context,
      updateWorkspaceFileContent,
      expect.objectContaining({
        fileId: 'pdf-1',
        assertedWorkspaceId: 'workspace-1',
      }),
      { fileId: 'pdf-1' }
    )
  })

  it('applies anchored patch intent through the shared edit engine', async () => {
    waitForLatestFileIntentMock.mockResolvedValue({
      operation: 'patch',
      fileId: 'text-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      fileRecord: { id: 'text-1', name: 'notes.md' },
      existingContent: 'before\nold\nafter\n',
      edit: {
        strategy: 'anchored',
        mode: 'replace_between',
        before_anchor: 'before',
        after_anchor: 'after',
      },
      createdAt: Date.now(),
    })

    await expect(editContentServerTool.execute({ content: 'new' }, context)).resolves.toMatchObject(
      {
        success: true,
      }
    )
    expect(compileDocForWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'before\nnew\nafter\n' })
    )
  })

  it('honors replaceAll for exact patch intent', async () => {
    waitForLatestFileIntentMock.mockResolvedValue({
      operation: 'patch',
      fileId: 'text-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      fileRecord: { id: 'text-1', name: 'notes.md' },
      existingContent: 'old old',
      edit: { strategy: 'search_replace', search: 'old', replaceAll: true },
      createdAt: Date.now(),
    })

    await expect(editContentServerTool.execute({ content: 'new' }, context)).resolves.toMatchObject(
      {
        success: true,
      }
    )
    expect(compileDocForWriteMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'new new' })
    )
  })
})
