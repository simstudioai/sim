/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { resolveWorkspaceFileReference } = vi.hoisted(() => ({
  resolveWorkspaceFileReference: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference,
}))

import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
}

describe('executeCopilotFileUseCase', () => {
  it('normalizes a file-scoped principal and calls the application use case', async () => {
    const execute = vi.fn().mockResolvedValue({ fileId: 'file-1' })
    const useCase = { operation: fileOperations.rename, execute }

    await expect(
      executeCopilotFileUseCase(
        trustedContext,
        useCase,
        { fileId: 'file-1', name: 'renamed.txt' },
        { fileId: 'file-1' }
      )
    ).resolves.toEqual({ fileId: 'file-1' })
    expect(execute).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'copilot-tool:tool-call-1',
        resourceScope: expect.objectContaining({ fileId: 'file-1' }),
      }),
      input: { fileId: 'file-1', name: 'renamed.txt' },
    })
  })

  it('fails before application execution for an untrusted context', () => {
    const execute = vi.fn()
    const useCase = { operation: fileOperations.readMetadata, execute }

    expect(() =>
      executeCopilotFileUseCase({ ...trustedContext, copilotToolExecution: false }, useCase, {
        fileId: 'file-1',
      })
    ).toThrow('trusted Copilot execution context')
    expect(execute).not.toHaveBeenCalled()
  })

  it('normalizes path reference resolution through the same boundary', async () => {
    resolveWorkspaceFileReference.mockResolvedValue({ id: 'file-1' })

    await expect(
      resolveCopilotWorkspaceFileReference(trustedContext, fileOperations.readContent, {
        workspaceId: 'workspace-1',
        reference: 'files/report.txt',
      })
    ).resolves.toEqual({ id: 'file-1' })
    expect(resolveWorkspaceFileReference).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        workspaceId: 'workspace-1',
        delegationId: 'copilot-tool:tool-call-1',
      }),
      operation: fileOperations.readContent,
      workspaceId: 'workspace-1',
      reference: 'files/report.txt',
    })
  })
})
