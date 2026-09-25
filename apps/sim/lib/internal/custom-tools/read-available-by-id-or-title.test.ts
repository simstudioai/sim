import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_TOOL_DELEGATION_AUDIENCE } from '@/lib/custom-tools/application/authorization'
import type { ExecutionContext } from '@/executor/types'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createPrincipal: vi.fn(),
    executeCopilot: vi.fn(),
    readUseCase: { execute: vi.fn() },
  },
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  readAvailableCustomToolByIdOrTitleUseCase: mocks.readUseCase,
}))

vi.mock('@/lib/mothership/application/execute-custom-tool-use-case', () => ({
  executeCopilotCustomToolUseCase: mocks.executeCopilot,
}))

import {
  readAvailableCustomToolByIdOrTitleAsCopilot,
  readAvailableCustomToolByIdOrTitleAsExecutor,
} from '@/lib/internal/custom-tools/read-available-by-id-or-title'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  subjectUserId: 'user-1',
  workspaceId: 'canonical-workspace',
  delegationId: 'delegation-1',
  audience: CUSTOM_TOOL_DELEGATION_AUDIENCE,
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2027-01-01T00:00:00Z'),
}

const tool = {
  id: 'tool-1',
  workspaceId: principal.workspaceId,
  userId: principal.subjectUserId,
  title: 'lookup_order',
  schema: { type: 'function' },
  code: 'return 1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function executionContext(abortSignal?: AbortSignal): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'untrusted-context-workspace',
    userId: 'user-1',
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    ...(abortSignal ? { abortSignal } : {}),
  }
}

describe('readAvailableCustomToolByIdOrTitleAsExecutor', () => {
  beforeEach(() => {
    mocks.createPrincipal.mockResolvedValue(principal)
    mocks.readUseCase.execute.mockResolvedValue({ tool })
    mocks.executeCopilot.mockResolvedValue({ tool })
  })

  it('constructs an executor principal and uses its canonical workspace', async () => {
    const context = executionContext()

    await expect(
      readAvailableCustomToolByIdOrTitleAsExecutor({
        context,
        identifier: tool.id,
        lookup: 'id',
      })
    ).resolves.toEqual(tool)

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context,
      audience: CUSTOM_TOOL_DELEGATION_AUDIENCE,
    })
    expect(mocks.readUseCase.execute).toHaveBeenCalledWith({
      principal,
      input: {
        workspaceId: principal.workspaceId,
        identifier: tool.id,
        lookup: 'id',
      },
    })
  })

  it('forwards the principal-bound legacy execution actor for an actorless principal', async () => {
    const context = executionContext()
    const actorlessPrincipal = {
      ...principal,
      subjectUserId: undefined,
      delegationContext: {
        kind: 'workflow_execution' as const,
        workflowId: 'workflow-1',
        compatibilityActor: {
          kind: 'legacy_execution_user' as const,
          userId: 'user-1',
        },
      },
    }
    mocks.createPrincipal.mockResolvedValueOnce(actorlessPrincipal)

    await readAvailableCustomToolByIdOrTitleAsExecutor({
      context,
      identifier: tool.id,
      lookup: 'id',
    })

    expect(mocks.readUseCase.execute).toHaveBeenCalledWith({
      principal: actorlessPrincipal,
      input: {
        workspaceId: principal.workspaceId,
        identifier: tool.id,
        lookup: 'id',
      },
    })
  })
})

describe('readAvailableCustomToolByIdOrTitleAsCopilot', () => {
  const context = {
    userId: 'user-1',
    workspaceId: 'canonical-workspace',
    chatId: 'chat-1',
    executionId: 'execution-1',
    toolCallId: 'tool-call-1',
    copilotToolExecution: true,
  } as const

  beforeEach(() => {
    mocks.executeCopilot.mockResolvedValue({ tool })
  })

  it('rejects forged Copilot authority before application execution', async () => {
    await expect(
      readAvailableCustomToolByIdOrTitleAsCopilot({
        context: { ...context, copilotToolExecution: false },
        identifier: tool.id,
        lookup: 'id',
      })
    ).rejects.toThrow('trusted Copilot execution context')

    expect(mocks.executeCopilot).not.toHaveBeenCalled()
  })
})
