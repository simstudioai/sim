/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveCopilotTablePrincipal } from '@/lib/copilot/auth/table-delegation'

describe('Copilot table delegation', () => {
  const context = {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    toolCallId: 'tool-call-1',
    chatId: 'chat-1',
    executionId: 'execution-1',
    copilotToolExecution: true,
  } as const

  it('binds the trusted workspace, subject, tool call, and table scope', () => {
    expect(resolveCopilotTablePrincipal(context, 'table-1')).toMatchObject({
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'copilot-tool:tool-call-1',
      audience: 'sim:tables',
      resourceScope: {
        tableId: 'table-1',
        chatId: 'chat-1',
        executionId: 'execution-1',
      },
    })
  })

  it('rejects untrusted or incomplete contexts', () => {
    expect(() =>
      resolveCopilotTablePrincipal({ ...context, copilotToolExecution: false }, 'table-1')
    ).toThrow('trusted Copilot execution context')
    expect(() =>
      resolveCopilotTablePrincipal({ ...context, workspaceId: undefined }, 'table-1')
    ).toThrow('workspace ID')
    expect(() =>
      resolveCopilotTablePrincipal({ ...context, toolCallId: undefined }, 'table-1')
    ).toThrow('tool call ID')
  })

  it('rejects an empty table scope before principal construction', () => {
    expect(() => resolveCopilotTablePrincipal(context, '')).toThrow('non-empty table ID')
    expect(() => resolveCopilotTablePrincipal(context, '   ')).toThrow('non-empty table ID')
  })
})
