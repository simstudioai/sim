import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  readPrefix: vi.fn(),
  append: vi.fn(),
  storeArtifact: vi.fn(),
  readArtifact: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/memory/conversation-store', () => ({
  openAgentMemoryTurn: hoisted.open,
  saveAgentMemoryTurn: hoisted.save,
  readConversationItems: hoisted.read,
  readConversationPrefix: hoisted.readPrefix,
  appendAgentMemoryMessage: hoisted.append,
}))
vi.mock('@/lib/memory/artifacts', () => ({
  storeMemoryArtifact: hoisted.storeArtifact,
  readMemoryArtifact: hoisted.readArtifact,
}))

import {
  appendAgentMemoryMessageUseCase,
  openAgentMemoryTurnUseCase,
  readAgentMemoryPrefixUseCase,
  saveAgentMemoryTurnUseCase,
  storeAgentMemoryArtifactUseCase,
} from '@/lib/memory/application/agent-turns'

const mocks = {
  ...hoisted,
  workspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const identity = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  blockId: 'agent-1',
  nodeId: 'agent-1',
  executionOrder: 3,
  conversationId: 'conversation-1',
}
function principal(): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    workspaceId: identity.workspaceId,
    delegationId: 'delegation-1',
    audience: 'sim:memory',
    issuedAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 60000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: identity.workflowId,
      executionId: identity.executionId,
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: identity.workspaceId,
        workflowId: identity.workflowId,
      },
      currentWorkflow: {
        workflowId: identity.workflowId,
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
    },
  }
}

describe('Agent memory application boundary', () => {
  beforeEach(() => {
    mocks.workspace.mockResolvedValue({
      workspaceId: identity.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-user',
    })
    mocks.open.mockResolvedValue({
      memoryId: 'memory-1',
      turnId: 'turn-1',
      encryptedState: null,
      revision: 0,
    })
  })

  it('authorizes the actual deployed execution before opening its turn', async () => {
    await expect(
      openAgentMemoryTurnUseCase.execute({ principal: principal(), input: identity })
    ).resolves.toMatchObject({ turnId: 'turn-1' })
    expect(mocks.open).toHaveBeenCalledWith(identity)
    expect(mocks.workspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.open.mock.invocationCallOrder[0]
    )
    expect(mocks.permission).not.toHaveBeenCalled()
  })

  it('rejects an unsupported principal before loading protected workspace context', async () => {
    await expect(
      openAgentMemoryTurnUseCase.execute({
        principal: createSessionPrincipal(),
        input: identity,
      })
    ).rejects.toThrow()
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it.each([{ executionId: 'different-execution' }, { workflowId: 'different-workflow' }])(
    'rejects identity outside its delegated execution: %j',
    async (mismatch) => {
      await expect(
        openAgentMemoryTurnUseCase.execute({
          principal: principal(),
          input: { ...identity, ...mismatch },
        })
      ).rejects.toThrow('does not match the execution')
      expect(mocks.open).not.toHaveBeenCalled()
    }
  )

  it('binds a child workflow to currentWorkflow while retaining the root execution identity', async () => {
    const actor = principal()
    actor.delegationContext!.currentWorkflow = {
      workflowId: 'child-workflow',
      mode: 'deployment',
      deploymentVersionId: 'child-deployment',
    }
    await openAgentMemoryTurnUseCase.execute({
      principal: actor,
      input: { ...identity, workflowId: 'child-workflow' },
    })
    expect(mocks.open).toHaveBeenCalledWith({ ...identity, workflowId: 'child-workflow' })
  })

  it('rejects expired delegation and mismatched workspace before a journal write', async () => {
    const expired = principal()
    expired.expiresAt = new Date(0)
    const input = {
      ...identity,
      memoryId: 'memory-1',
      turnId: 'turn-1',
      expectedRevision: 0,
      encryptedState: 'private',
    }
    await expect(
      saveAgentMemoryTurnUseCase.execute({ principal: expired, input })
    ).rejects.toThrow()
    await expect(
      saveAgentMemoryTurnUseCase.execute({
        principal: { ...principal(), workspaceId: 'other-workspace' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rechecks a human executor subject’s current write access', async () => {
    const actor = principal()
    actor.delegationContext!.principal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }
    mocks.permission.mockResolvedValue('read')
    await expect(
      openAgentMemoryTurnUseCase.execute({ principal: actor, input: identity })
    ).rejects.toThrow('Insufficient workspace permissions')
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('binds turn input writes to the authorized execution rather than caller-supplied authority', async () => {
    const input = {
      workspaceId: identity.workspaceId,
      conversationId: identity.conversationId,
      memoryId: 'memory-1',
      turnId: 'turn-1',
      appendKey: 'input',
      data: { role: 'user', content: 'hello' },
    }
    await appendAgentMemoryMessageUseCase.execute({ principal: principal(), input })
    expect(mocks.append).toHaveBeenCalledWith({
      ...input,
      workflowId: identity.workflowId,
      executionId: identity.executionId,
    })
    await expect(
      readAgentMemoryPrefixUseCase.execute({
        principal: { ...principal(), workspaceId: 'other-workspace' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.readPrefix).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'derives artifact upload attribution after authorizing the execution (human: %s)',
    async (human) => {
      const actor = principal()
      if (human) {
        actor.subjectUserId = 'human-user'
        actor.delegationContext!.principal = {
          kind: 'session',
          userId: 'human-user',
          sessionId: 'session-1',
        }
        mocks.permission.mockResolvedValue('write')
      }
      const input = {
        workspaceId: identity.workspaceId,
        workflowId: identity.workflowId,
        executionId: identity.executionId,
        memoryId: 'memory-1',
        value: { output: 'large result' },
        attributedUserId: 'caller-supplied-user',
      }
      await storeAgentMemoryArtifactUseCase.execute({ principal: actor, input })
      expect(mocks.storeArtifact).toHaveBeenCalledWith({
        ...input,
        attributedUserId: human ? 'human-user' : 'billing-user',
      })
      expect(mocks.workspace.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.storeArtifact.mock.invocationCallOrder[0]
      )
    }
  )

  it('rejects an artifact outside its delegated invocation before storing it', async () => {
    await expect(
      storeAgentMemoryArtifactUseCase.execute({
        principal: principal(),
        input: {
          workspaceId: identity.workspaceId,
          workflowId: identity.workflowId,
          executionId: 'other-execution',
          memoryId: 'memory-1',
          value: 'result',
        },
      })
    ).rejects.toThrow('does not match the execution')
    expect(mocks.storeArtifact).not.toHaveBeenCalled()
  })
})
