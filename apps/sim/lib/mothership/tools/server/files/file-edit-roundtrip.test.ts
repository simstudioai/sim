/** @vitest-environment node */
import { generateId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
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

import { extractResourcesFromToolResult } from '@/lib/mothership/resources/extraction'
import { editContentServerTool } from '@/lib/mothership/tools/server/files/edit-content'
import {
  consumeLatestFileIntent,
  type PendingFileIntent,
  storeFileIntent,
} from '@/lib/mothership/tools/server/files/file-intent-store'
import { workspaceFileServerTool } from '@/lib/mothership/tools/server/files/workspace-file'
import { createWorkspaceFile } from '@/lib/workspace-files/application/create-workspace-file'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
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
  beforeEach(() => {
    vi.clearAllMocks()
    executeFileUseCase.mockReset()
  })

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
    expect(extractResourcesFromToolResult('apply_file_edit', { content }, applied)).toEqual([
      { type: 'file', id: created.id, title: created.name },
    ])
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
      expect.objectContaining({
        fileId: created.id,
        content,
        expectedRevision: workspaceFileRevision(created),
      }),
      { fileId: created.id }
    )
    expect(
      await consumeLatestFileIntent(prepareContext.workspaceId!, prepareContext)
    ).toBeUndefined()
  })

  it.each(['append', 'patch'] as const)(
    'binds %s to the revision returned with its content, not the earlier target lookup',
    async (operation) => {
      const ctx = context()
      const initial = file('notes.md', ctx.workspaceId!)
      const current = { ...initial, contentUpdatedAt: new Date('2030-01-02T00:00:00Z') }
      executeFileUseCase
        .mockResolvedValueOnce({ file: initial })
        .mockResolvedValueOnce({ file: current, content: Buffer.from('original') })
        .mockResolvedValueOnce({ file: current })

      const prepared = await workspaceFileServerTool.execute(
        {
          operation,
          target: { kind: 'file_id', fileId: initial.id },
          ...(operation === 'patch'
            ? { edit: { strategy: 'search_replace' as const, search: 'original' } }
            : {}),
        },
        ctx
      )
      expect(prepared.success, prepared.message).toBe(true)
      expect(executeFileUseCase).toHaveBeenNthCalledWith(
        2,
        ctx,
        readWorkspaceFileContent,
        { fileId: initial.id, assertedWorkspaceId: ctx.workspaceId },
        { fileId: initial.id }
      )
      const applied = await editContentServerTool.execute({ content: 'next' }, ctx)
      expect(applied.success, applied.message).toBe(true)
      expect(executeFileUseCase).toHaveBeenLastCalledWith(
        ctx,
        updateWorkspaceFileContent,
        expect.objectContaining({
          expectedRevision: workspaceFileRevision(current),
          content: operation === 'append' ? 'original\nnext' : 'next',
        }),
        { fileId: initial.id }
      )
    }
  )

  it('returns a typed conflict when another writer changes a prepared replacement', async () => {
    const ctx = context()
    const original = file('notes.md', ctx.workspaceId!)
    executeFileUseCase
      .mockResolvedValueOnce({ file: original })
      .mockRejectedValueOnce(new OrchestrationError('conflict', 'Content changed'))
    const prepared = await workspaceFileServerTool.execute(
      { operation: 'update', target: { kind: 'file_id', fileId: original.id } },
      ctx
    )
    expect(prepared.success, prepared.message).toBe(true)
    const applied = await editContentServerTool.execute({ content: 'replacement' }, ctx)
    expect(applied).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(applied.message).toContain('prepare_file_edit again')
    expect(executeFileUseCase).toHaveBeenLastCalledWith(
      ctx,
      updateWorkspaceFileContent,
      expect.objectContaining({ expectedRevision: workspaceFileRevision(original) }),
      { fileId: original.id }
    )
    expect(extractResourcesFromToolResult('apply_file_edit', {}, applied)).toEqual([])
  })

  it('projects a lost preparation claim as a conflict without compiling or writing', async () => {
    const intentStore = await import('@/lib/mothership/tools/server/files/file-intent-store')
    const claim = vi
      .spyOn(intentStore, 'waitForLatestFileIntent')
      .mockRejectedValueOnce(new OrchestrationError('conflict', 'Preparation already claimed'))
    try {
      const applied = await editContentServerTool.execute({ content: 'content for A' }, context())
      expect(applied).toMatchObject({ success: false, errorCode: 'conflict' })
      expect(applied.message).toContain('prepare_file_edit again')
      expect(executeFileUseCase).not.toHaveBeenCalled()
      expect(compileDoc).not.toHaveBeenCalled()
      expect(runSandboxTask).not.toHaveBeenCalled()
    } finally {
      claim.mockRestore()
    }
  })

  it('refuses legacy preparations without a revision before compiling or writing', async () => {
    const ctx = context()
    const original = file('notes.md', ctx.workspaceId!)
    await storeFileIntent(ctx.workspaceId!, original.id, {
      operation: 'update',
      fileId: original.id,
      workspaceId: ctx.workspaceId!,
      userId: ctx.userId!,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      fileRecord: original,
      createdAt: Date.now(),
    } as PendingFileIntent)
    const applied = await editContentServerTool.execute({ content: 'replacement' }, ctx)
    expect(applied).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(executeFileUseCase).not.toHaveBeenCalled()
    expect(compileDoc).not.toHaveBeenCalled()
  })

  it('keeps both same-file preparations and lets the shared write precondition reject the loser', async () => {
    const common = context()
    const original = file('shared.md', common.workspaceId!)
    const contexts = ['first', 'second'].map((parentToolCallId) => ({
      ...common,
      parentToolCallId,
    }))
    let committedContent: string | undefined
    executeFileUseCase.mockImplementation(async (_context, useCase, input) => {
      if (useCase !== updateWorkspaceFileContent) return { file: original }
      expect(input.expectedRevision).toBe(workspaceFileRevision(original))
      if (committedContent !== undefined) {
        throw new OrchestrationError('conflict', 'A newer revision is already stored')
      }
      committedContent = input.content
      return { file: original }
    })
    const prepared = await Promise.all(
      contexts.map((ctx) =>
        workspaceFileServerTool.execute(
          { operation: 'update', target: { kind: 'file_id', fileId: original.id } },
          ctx
        )
      )
    )
    expect(prepared.every((result) => result.success)).toBe(true)
    const applied = await Promise.all(
      contexts.map((ctx, index) =>
        editContentServerTool.execute({ content: `writer-${index}` }, ctx)
      )
    )
    expect(applied.filter((result) => result.success)).toHaveLength(1)
    expect(applied.filter((result) => result.errorCode === 'conflict')).toHaveLength(1)
    expect(committedContent).toBe(`writer-${applied.findIndex((result) => result.success)}`)
    expect(executeFileUseCase).toHaveBeenCalledTimes(4)
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
