/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import { BlockType } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  requireWorkspaceId: vi.fn(() => 'workspace-1'),
  createInviteLink: vi.fn(),
  enforceInviteRateLimit: vi.fn(),
  listCredentials: vi.fn(),
  listGroups: vi.fn(),
  listPeople: vi.fn(),
  sendInvite: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/create-invite-link', () => ({
  createCredentialGroupInviteLink: { execute: mocks.createInviteLink },
}))

vi.mock('@/lib/credential-groups/application/list-credentials', () => ({
  listCredentialGroupCredentials: { execute: mocks.listCredentials },
}))

vi.mock('@/lib/credential-groups/application/list-groups', () => ({
  listCredentialGroupsForWorkflow: { execute: mocks.listGroups },
}))

vi.mock('@/lib/credential-groups/application/list-people', () => ({
  CREDENTIAL_GROUP_PEOPLE_STATUSES: [
    'invited',
    'delivery_failed',
    'in_progress',
    'completed',
    'revoked',
  ],
  listCredentialGroupPeople: { execute: mocks.listPeople },
}))

vi.mock('@/lib/credential-groups/application/send-invite', () => ({
  sendCredentialGroupInvite: { execute: mocks.sendInvite },
}))

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforceCredentialGroupInvitationExecutionRateLimit: mocks.enforceInviteRateLimit,
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
  requireExecutorWorkspaceId: mocks.requireWorkspaceId,
}))

import { CredentialGroupBlockHandler } from '@/executor/handlers/credential-group/credential-group-handler'

const principal = createTestRuntimePrincipal()

const context = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  userId: 'user-1',
  principal,
} as ExecutionContext

const block = { metadata: { id: BlockType.CREDENTIAL_GROUP } } as SerializedBlock

describe('CredentialGroupBlockHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue(principal)
  })

  it('recognizes only Credential Group blocks', () => {
    const handler = new CredentialGroupBlockHandler()

    expect(handler.canHandle(block)).toBe(true)
    expect(handler.canHandle({ metadata: { id: BlockType.CREDENTIAL } } as SerializedBlock)).toBe(
      false
    )
  })

  it('keeps the selected group on application input instead of principal metadata', async () => {
    mocks.listCredentials.mockResolvedValue({
      credentials: [],
      count: 0,
      hasMore: false,
      nextCursor: null,
    })

    const result = await new CredentialGroupBlockHandler().execute(context, block, {
      operation: 'list_credentials',
      credentialGroupId: ' group-1 ',
      email: ' person@example.com ',
      credentialProviderIds: '["google-email", "google-email"]',
      limit: '25',
      cursor: ' credential-1 ',
    })

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context,
    })
    expect(mocks.listCredentials).toHaveBeenCalledWith({
      principal,
      input: {
        credentialGroupId: 'group-1',
        assertedWorkspaceId: 'workspace-1',
        email: 'person@example.com',
        credentialProviderIds: ['google-email'],
        limit: 25,
        cursor: 'credential-1',
      },
    })
    expect(result).toEqual({ credentials: [], count: 0, hasMore: false, nextCursor: null })
  })

  it('lists credentials for an actorless workflow execution', async () => {
    const actorlessPrincipal = createTestRuntimePrincipal({
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-version-1',
      },
    })
    const actorlessContext = {
      ...context,
      userId: undefined,
      principal: actorlessPrincipal,
    } as ExecutionContext
    mocks.createPrincipal.mockResolvedValueOnce(actorlessPrincipal)
    mocks.listCredentials.mockResolvedValue({
      credentials: [],
      count: 0,
      hasMore: false,
      nextCursor: null,
    })

    await new CredentialGroupBlockHandler().execute(actorlessContext, block, {
      operation: 'list_credentials',
      credentialGroupId: 'group-1',
    })

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: actorlessContext,
    })
    expect(mocks.listCredentials).toHaveBeenCalledWith({
      principal: actorlessPrincipal,
      input: {
        credentialGroupId: 'group-1',
        assertedWorkspaceId: 'workspace-1',
        limit: 100,
        cursor: undefined,
        email: undefined,
        credentialProviderIds: undefined,
      },
    })
  })

  it('lists groups under workspace-scoped delegation', async () => {
    mocks.listGroups.mockResolvedValue({
      credentialGroups: [],
      count: 0,
      hasMore: false,
      nextCursor: null,
    })

    await new CredentialGroupBlockHandler().execute(context, block, {
      operation: 'list_groups',
      limit: 10,
    })

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context,
    })
    expect(mocks.listGroups).toHaveBeenCalledWith({
      principal,
      input: { workspaceId: 'workspace-1', limit: 10, cursor: undefined },
    })
  })

  it('applies the shared workspace invitation budget before sending', async () => {
    mocks.sendInvite.mockResolvedValue({
      enrollment: {
        id: 'enrollment-1',
        email: 'person@example.com',
        status: 'invited',
        invitedAt: '2026-08-13T12:00:00.000Z',
        expiresAt: '2026-08-20T12:00:00.000Z',
      },
    })

    await new CredentialGroupBlockHandler().execute(context, block, {
      operation: 'send_invite',
      credentialGroupId: 'group-1',
      email: ' person@example.com ',
    })

    expect(mocks.enforceInviteRateLimit).toHaveBeenCalledWith('workspace-1')
    expect(mocks.enforceInviteRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendInvite.mock.invocationCallOrder[0]!
    )
    expect(mocks.sendInvite).toHaveBeenCalledWith({
      principal,
      input: {
        credentialGroupId: 'group-1',
        assertedWorkspaceId: 'workspace-1',
        email: 'person@example.com',
      },
    })
  })

  it('issues a fresh invitation link without routing through email delivery', async () => {
    mocks.createInviteLink.mockResolvedValue({
      enrollment: {
        id: 'enrollment-1',
        email: 'person@example.com',
        status: 'invited',
        invitedAt: '2026-08-13T12:00:00.000Z',
        expiresAt: '2026-08-20T12:00:00.000Z',
      },
      invitationLink: 'https://sim.ai/credential-groups/enroll/token-1',
    })

    const result = await new CredentialGroupBlockHandler().execute(context, block, {
      operation: 'get_invite_link',
      credentialGroupId: ' group-1 ',
      email: ' person@example.com ',
    })

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context,
    })
    expect(mocks.enforceInviteRateLimit).toHaveBeenCalledWith('workspace-1')
    expect(mocks.enforceInviteRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createInviteLink.mock.invocationCallOrder[0]!
    )
    expect(mocks.createInviteLink).toHaveBeenCalledWith({
      principal,
      input: {
        credentialGroupId: 'group-1',
        assertedWorkspaceId: 'workspace-1',
        email: 'person@example.com',
      },
    })
    expect(mocks.sendInvite).not.toHaveBeenCalled()
    expect(result).toEqual({
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
      status: 'invited',
      invitedAt: '2026-08-13T12:00:00.000Z',
      expiresAt: '2026-08-20T12:00:00.000Z',
      invitationLink: 'https://sim.ai/credential-groups/enroll/token-1',
    })
  })

  it('fails fast on unsupported people statuses', async () => {
    await expect(
      new CredentialGroupBlockHandler().execute(context, block, {
        operation: 'list_people',
        credentialGroupId: 'group-1',
        peopleStatuses: ['unknown'],
      })
    ).rejects.toThrow('People statuses contain an unsupported value')
    expect(mocks.listPeople).not.toHaveBeenCalled()
  })

  it('rejects unsupported operations before delegation', async () => {
    await expect(
      new CredentialGroupBlockHandler().execute(context, block, { operation: 'unknown' })
    ).rejects.toThrow('Unsupported Credential Group operation: unknown')
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
  })
})
