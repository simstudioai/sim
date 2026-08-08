/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createCopilotFilePrincipal,
  messageForCopilotFileError,
} from '@/lib/copilot/auth/file-delegation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
}

describe('Copilot file delegation', () => {
  it('creates a short-lived principal scoped to the trusted workspace and file', () => {
    const principal = createCopilotFilePrincipal(trustedContext, 'workspace-1', 'file-1')

    expect(principal).toMatchObject({
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'copilot-tool:tool-call-1',
      audience: 'sim:workspace-files',
      resourceScope: {
        fileId: 'file-1',
        chatId: 'chat-1',
        executionId: 'execution-1',
      },
    })
    expect(principal.expiresAt.getTime()).toBeGreaterThan(principal.issuedAt.getTime())
  })

  it('creates a workspace-scoped principal for file creation', () => {
    const principal = createCopilotFilePrincipal(trustedContext, 'workspace-1')

    expect(principal.resourceScope).toEqual({
      chatId: 'chat-1',
      executionId: 'execution-1',
    })
  })

  it('rejects contexts that were not issued by the Copilot execution pipeline', () => {
    expect(() =>
      createCopilotFilePrincipal(
        { ...trustedContext, copilotToolExecution: false },
        'workspace-1',
        'file-1'
      )
    ).toThrow('trusted Copilot execution context')
    expect(() =>
      createCopilotFilePrincipal(
        { ...trustedContext, toolCallId: undefined },
        'workspace-1',
        'file-1'
      )
    ).toThrow('tool call ID')
  })

  it('rejects a workspace that differs from the server context', () => {
    expect(() => createCopilotFilePrincipal(trustedContext, 'workspace-2', 'file-1')).toThrow(
      'workspace does not match'
    )
  })

  it('projects only typed domain messages to Copilot', () => {
    expect(messageForCopilotFileError(new OrchestrationError('conflict', 'Name exists'))).toBe(
      'Name exists'
    )
    expect(
      messageForCopilotFileError(
        new Error('update workspace_files set ...'),
        'Failed to rename file'
      )
    ).toBe('Failed to rename file')
  })
})
