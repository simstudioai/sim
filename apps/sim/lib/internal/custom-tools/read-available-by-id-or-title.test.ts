/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createPrincipal: vi.fn(),
    requireWorkspaceId: vi.fn(() => 'canonical-workspace'),
    executeCopilot: vi.fn(),
    readUseCase: { execute: vi.fn() },
  },
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
  requireExecutorWorkspaceId: mocks.requireWorkspaceId,
}))

vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  readAvailableCustomToolByIdOrTitleUseCase: mocks.readUseCase,
}))

vi.mock('@/lib/copilot/application/execute-custom-tool-use-case', () => ({
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
  audience: 'sim:custom-tools',
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
    vi.clearAllMocks()
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

  it('stops before principal construction when execution is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(
      readAvailableCustomToolByIdOrTitleAsExecutor({
        context: executionContext(controller.signal),
        identifier: tool.id,
        lookup: 'id_or_title',
      })
    ).rejects.toThrow('cancelled')

    expect(mocks.createPrincipal).not.toHaveBeenCalled()
    expect(mocks.readUseCase.execute).not.toHaveBeenCalled()
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
    vi.clearAllMocks()
    mocks.executeCopilot.mockResolvedValue({ tool })
  })

  it('enters the shared Copilot use case with canonical trusted scope', async () => {
    await expect(
      readAvailableCustomToolByIdOrTitleAsCopilot({
        context,
        identifier: tool.id,
        lookup: 'id_or_title',
      })
    ).resolves.toEqual(tool)

    expect(mocks.executeCopilot).toHaveBeenCalledWith(context, mocks.readUseCase, {
      workspaceId: context.workspaceId,
      identifier: tool.id,
      lookup: 'id_or_title',
    })
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

  it('stops before application execution when the caller is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(
      readAvailableCustomToolByIdOrTitleAsCopilot({
        context,
        identifier: tool.id,
        lookup: 'id',
        signal: controller.signal,
      })
    ).rejects.toThrow('cancelled')

    expect(mocks.executeCopilot).not.toHaveBeenCalled()
  })
})
