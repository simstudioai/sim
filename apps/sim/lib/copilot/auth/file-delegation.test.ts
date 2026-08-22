/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createCopilotChatFilePrincipal,
  createCopilotWorkspaceContextFilePrincipal,
  messageForCopilotFileError,
  resolveCopilotFilePrincipal,
} from '@/lib/copilot/auth/file-delegation'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'
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
  it('creates an orchestration-bounded principal scoped to the trusted workspace and file', () => {
    const principal = resolveCopilotFilePrincipal(trustedContext, 'file-1')

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
    expect(principal.expiresAt.getTime() - principal.issuedAt.getTime()).toBe(
      ORCHESTRATION_TIMEOUT_MS
    )
  })

  it('creates a workspace-scoped principal for file creation', () => {
    const principal = resolveCopilotFilePrincipal(trustedContext)

    expect(principal.resourceScope).toEqual({
      chatId: 'chat-1',
      executionId: 'execution-1',
    })
  })

  it('rejects contexts that were not issued by the Copilot execution pipeline', () => {
    expect(() =>
      resolveCopilotFilePrincipal({ ...trustedContext, copilotToolExecution: false }, 'file-1')
    ).toThrow('trusted Copilot execution context')
    expect(() =>
      resolveCopilotFilePrincipal({ ...trustedContext, toolCallId: undefined }, 'file-1')
    ).toThrow('tool call ID')
  })

  it('rejects a missing execution workspace', () => {
    expect(() =>
      resolveCopilotFilePrincipal({ ...trustedContext, workspaceId: undefined }, 'file-1')
    ).toThrow('workspace ID')
  })

  it('normalizes chat and workspace-index identities without caller-built delegation fields', () => {
    expect(
      createCopilotChatFilePrincipal({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
      })
    ).toMatchObject({
      delegationId: 'copilot-chat:chat-1',
      resourceScope: { chatId: 'chat-1' },
    })
    expect(
      createCopilotWorkspaceContextFilePrincipal({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
      })
    ).toMatchObject({
      delegationId: 'copilot-workspace-context:execution-1',
      resourceScope: { executionId: 'execution-1' },
    })
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
