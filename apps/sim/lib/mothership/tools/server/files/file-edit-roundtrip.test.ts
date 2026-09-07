/** @vitest-environment node */
import { generateId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const { executeFileUseCase, compileDoc, runSandboxTask } = vi.hoisted(() => ({
  executeFileUseCase: vi.fn(),
  compileDoc: vi.fn(),
  runSandboxTask: vi.fn(),
}))

vi.mock('@/lib/mothership/application/execute-file-use-case', () => ({
  executeCopilotFileUseCase: executeFileUseCase,
  resolveCopilotWorkspaceFileReference: vi.fn(async () => undefined),
}))
vi.mock('@/lib/mothership/auth/file-delegation', () => ({
  resolveCopilotFilePrincipal: () => ({ kind: 'session', userId: 'user-1' }),
  messageForCopilotFileError: (_error: unknown, fallback: string) => fallback,
}))
vi.mock('@/lib/execution/sandbox/run-task', () => ({ runSandboxTask }))
vi.mock('@/lib/mothership/tools/server/files/doc-compile', () => ({
  compileDoc,
  getE2BDocFormat: async () => null,
  DOCXJS_SOURCE_MIME: 'text/x-docxjs',
  PPTXGENJS_SOURCE_MIME: 'text/x-pptxgenjs',
}))
vi.mock('@/lib/mothership/tools/server/files/embedded-image-refs', () => ({
  buildEmbeddedImageRefWarning: async () => '',
}))
vi.mock('@/lib/mothership/tools/server/files/file-folder-application', () => ({
  ensureCopilotFileFolderPath: async () => null,
}))
vi.mock('@/lib/workspace-files/application/create-workspace-file', () => ({
  admitCreateWorkspaceFile: async () => {},
  createWorkspaceFile: { execute: vi.fn() },
}))
vi.mock('@/lib/workspace-files/application/delete-workspace-file', () => ({
  deleteWorkspaceFileOperation: { execute: vi.fn() },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: vi.fn() },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => ({
  readWorkspaceFileMetadata: { execute: vi.fn() },
}))
vi.mock('@/lib/workspace-files/application/rename-workspace-file', () => ({
  renameWorkspaceFile: { execute: vi.fn() },
}))
vi.mock('@/lib/workspace-files/application/update-workspace-file-content', () => ({
  updateWorkspaceFileContent: { execute: vi.fn() },
}))

import { editContentServerTool } from '@/lib/mothership/tools/server/files/edit-content'
import { consumeLatestFileIntent } from '@/lib/mothership/tools/server/files/file-intent-store'
import { workspaceFileServerTool } from '@/lib/mothership/tools/server/files/workspace-file'
import { createWorkspaceFile } from '@/lib/workspace-files/application/create-workspace-file'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'

function file(name: string, workspaceId: string): WorkspaceFileRecord {
  return {
    id: generateId(),
    workspaceId,
    name,
    key: name,
    path: name,
    size: 0,
    type: 'text/markdown',
    uploadedBy: 'user-1',
    uploadedAt: new Date(),
    updatedAt: new Date(),
  }
}

function context(workspaceId = generateId()): ServerToolContext {
  return {
    userId: 'user-1',
    workspaceId,
    chatId: 'chat',
    messageId: 'message',
    toolCallId: 'prepare',
  }
}

describe('prepared file write across tool invocations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates then applies content in a new tool context without another prepare', async () => {
    const prepareContext = context()
    const created = file('actions.md', prepareContext.workspaceId!)
    executeFileUseCase.mockResolvedValue({ file: created })
    const prepared = await workspaceFileServerTool.execute(
      {
        operation: 'create',
        target: { kind: 'new_file', fileName: created.name },
        title: 'Actions',
      },
      prepareContext
    )
    expect(prepared.success).toBe(true)
    const content = '- [ ] Check the result — Dana\n'
    const applyContext = { ...prepareContext, toolCallId: 'apply' }
    const applied = await editContentServerTool.execute({ content }, applyContext)
    expect(applied.success, applied.message).toBe(true)
    expect(executeFileUseCase).toHaveBeenNthCalledWith(
      1,
      prepareContext,
      createWorkspaceFile,
      expect.objectContaining({ content: '', name: created.name })
    )
    expect(executeFileUseCase).toHaveBeenNthCalledWith(
      2,
      applyContext,
      updateWorkspaceFileContent,
      expect.objectContaining({ fileId: created.id, content }),
      { fileId: created.id }
    )
    expect(
      await consumeLatestFileIntent(prepareContext.workspaceId!, prepareContext)
    ).toBeUndefined()
  })

  it('prepares empty document targets without trying to compile absent source', async () => {
    const prepareContext = context()
    const created = file('report.pdf', prepareContext.workspaceId!)
    executeFileUseCase.mockResolvedValue({ file: created })
    const prepared = await workspaceFileServerTool.execute(
      {
        operation: 'create',
        target: { kind: 'new_file', fileName: created.name },
        title: 'Report',
      },
      prepareContext
    )
    expect(prepared.success, prepared.message).toBe(true)
    expect(runSandboxTask).not.toHaveBeenCalled()
    expect(compileDoc).not.toHaveBeenCalled()
    expect(
      (await consumeLatestFileIntent(prepareContext.workspaceId!, prepareContext))?.fileId
    ).toBe(created.id)
  })

  it('keeps parallel subagent file preparations on their own channels', async () => {
    const common = context()
    const first = { ...common, parentToolCallId: 'child-a' }
    const second = { ...common, parentToolCallId: 'child-b' }
    const files = [file('a.md', common.workspaceId!), file('b.md', common.workspaceId!)]
    executeFileUseCase
      .mockResolvedValueOnce({ file: files[0] })
      .mockResolvedValueOnce({ file: files[1] })
    await Promise.all(
      [first, second].map((ctx, index) =>
        workspaceFileServerTool.execute(
          {
            operation: 'create',
            target: { kind: 'new_file', fileName: files[index]!.name },
            title: 'Write',
          },
          ctx
        )
      )
    )
    await editContentServerTool.execute({ content: 'A' }, { ...first, toolCallId: 'apply-a' })
    await editContentServerTool.execute({ content: 'B' }, { ...second, toolCallId: 'apply-b' })
    expect(executeFileUseCase).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ parentToolCallId: 'child-a' }),
      updateWorkspaceFileContent,
      expect.objectContaining({ fileId: files[0]!.id, content: 'A' }),
      { fileId: files[0]!.id }
    )
    expect(executeFileUseCase).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ parentToolCallId: 'child-b' }),
      updateWorkspaceFileContent,
      expect.objectContaining({ fileId: files[1]!.id, content: 'B' }),
      { fileId: files[1]!.id }
    )
  })
})
