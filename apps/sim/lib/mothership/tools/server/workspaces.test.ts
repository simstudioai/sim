import { db } from '@sim/db'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
  audit: vi.fn(),
  membership: vi.fn(),
}))
vi.mock('@/lib/workspaces/create', () => ({ createWorkspace: hoisted.create }))
vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import * as applicationAudit from '@/lib/core/application/authorized-workspace-use-case'
import { executeOrganizationWorkspaceUseCase } from '@/lib/mothership/application/execute-organization-workspace-use-case'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { ResourceChanges } from '@/lib/mothership/generated/resources'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { routeExecution } from '@/lib/mothership/tools/server/router'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { createOrganizationWorkspace } from '@/lib/workspaces/application/create-organization-workspace'
import * as policy from '@/lib/workspaces/policy'

const mocks = {
  ...hoisted,
  chat: mothershipOrganizationChatsMockFns.mockAuthorizeOrganizationChatDelegation,
  config: permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
}

const context: ServerToolContext = {
  userId: 'actor',
  organizationId: 'org',
  chatId: 'chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'agent',
}
const principal = createTrustedOrganizationCopilotPrincipal(
  { userId: 'actor', organizationId: 'org', chatId: 'chat', delegationId: 'call' },
  { audience: 'sim:workspaces', ttlMs: 60_000 }
)
const creationPolicy: Awaited<ReturnType<typeof policy.getWorkspaceCreationPolicy>> = {
  canCreate: true,
  organizationId: 'org',
  workspaceMode: 'organization',
  billedAccountUserId: 'billing-owner',
  observedOrganizationId: 'org',
  governingPermissionGroupOrganizationId: 'org',
  maxWorkspaces: null,
  currentWorkspaceCount: 0,
  reason: null,
  status: 200,
}
const workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Research',
  organizationId: 'org',
  workspaceMode: 'organization',
  permissions: 'admin',
}
let readPolicy: MockInstance<typeof policy.getWorkspaceCreationPolicy>
beforeEach(() => {
  readPolicy = vi.spyOn(policy, 'getWorkspaceCreationPolicy')
  vi.spyOn(applicationAudit, 'recordProjectedUseCaseAuditEntries').mockImplementation(mocks.audit)
})

beforeEach(() => {
  mocks.create.mockResolvedValue(workspace)
  mocks.chat.mockResolvedValue({ organizationId: 'org' })
  mocks.membership.mockResolvedValue([{ role: 'member' }])
  mocks.config.mockResolvedValue(null)
  readPolicy.mockResolvedValue(creationPolicy)
  const query = { from: vi.fn(), where: vi.fn(), limit: mocks.membership }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
})

describe('organization workspace creation through the real tool router', () => {
  it.each([undefined, true, false])(
    'uses the shared creation policy and manager with skip=%s',
    async (skipDefaultWorkflow) => {
      const result = await routeExecution(
        'workspaces',
        {
          action: 'create',
          name: ' Research ',
          ...(skipDefaultWorkflow === undefined ? {} : { skipDefaultWorkflow }),
        },
        context
      )
      expect(result).toEqual({
        success: true,
        workspace,
        resources: ResourceChanges.parse([
          {
            op: 'refresh',
            resource: {
              type: 'settings',
              scope: 'organization',
              organizationId: 'org',
              id: 'workspaces',
            },
          },
        ]),
      })
      expect(readPolicy).toHaveBeenCalledExactlyOnceWith({
        userId: 'actor',
        activeOrganizationId: 'org',
        pinOrganization: true,
      })
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        name: 'Research',
        skipDefaultWorkflow: skipDefaultWorkflow ?? false,
        userId: 'actor',
        organizationId: 'org',
        workspaceMode: 'organization',
        billedAccountUserId: 'billing-owner',
        observedOrganizationId: 'org',
        governingPermissionGroupOrganizationId: 'org',
      })
      expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
        createOrganizationWorkspace.operation,
        workspace.id,
        expect.objectContaining({
          subjectUserId: 'actor',
          organizationId: 'org',
          resourceScope: { chatId: 'chat' },
        }),
        undefined,
        [expect.objectContaining({ resourceId: workspace.id, resourceName: 'Research' })],
        'org'
      )
    }
  )

  it.each([
    { requestMode: 'assistant' },
    { workspaceId: 'workspace' },
    { workflowId: 'workflow' },
    { copilotToolExecution: false },
    { organizationId: undefined },
    { userId: undefined },
    { chatId: undefined },
  ])('rejects unavailable or untrusted context %j', async (override) => {
    expect(
      await routeExecution(
        'workspaces',
        { action: 'create', name: 'Research' },
        { ...context, ...override }
      )
    ).toMatchObject({ success: false })
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(readPolicy).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([
    { organizationId: 'other' },
    { userId: 'owner' },
    { billedAccountUserId: 'owner' },
    { workspaceId: 'workspace' },
  ])('rejects caller-selected authority %j', async (injected) => {
    await expect(
      routeExecution('workspaces', { action: 'create', name: 'Research', ...injected }, context)
    ).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects an empty name before dispatch', async () => {
    await expect(
      routeExecution('workspaces', { action: 'create', name: '  ' }, context)
    ).rejects.toThrow('name')
    expect(mocks.chat).not.toHaveBeenCalled()
  })

  it('rechecks membership and private chat access before creating', async () => {
    mocks.membership.mockResolvedValueOnce([])
    expect(
      await routeExecution('workspaces', { action: 'create', name: 'Research' }, context)
    ).toEqual({ success: false, message: 'Organization not found' })
    expect(readPolicy).not.toHaveBeenCalled()
    mocks.chat.mockRejectedValueOnce(new Error('private chat unavailable'))
    expect(
      await routeExecution('workspaces', { action: 'create', name: 'Research' }, context)
    ).toEqual({ success: false, message: 'Workspace creation failed' })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('preserves plan and role refusals from the UI policy without attempting a write', async () => {
    readPolicy.mockResolvedValueOnce({
      ...creationPolicy,
      canCreate: false,
      status: 403,
      reason: 'Only organization owners and admins can create organization workspaces.',
    })
    expect(
      await routeExecution('workspaces', { action: 'create', name: 'Research' }, context)
    ).toEqual({
      success: false,
      message: 'Only organization owners and admins can create organization workspaces.',
    })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('never turns a lapsed organization request into a personal workspace', async () => {
    readPolicy.mockResolvedValueOnce({
      ...creationPolicy,
      organizationId: null,
      workspaceMode: 'personal',
    })
    expect(
      await routeExecution('workspaces', { action: 'create', name: 'Research' }, context)
    ).toEqual({
      success: false,
      message: 'This organization cannot create workspaces under its current subscription',
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('enforces the current user’s workspace creation capability before reading the creation policy', async () => {
    mocks.config.mockResolvedValueOnce({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableWorkspaceCreation: true,
    })
    expect(
      await routeExecution('workspaces', { action: 'create', name: 'Research' }, context)
    ).toMatchObject({ success: false, message: expect.stringContaining('permission group') })
    expect(readPolicy).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('retains permission-group and membership rechecks inside the creation transaction', async () => {
    for (const error of [
      new policy.WorkspaceCreationCapabilityWithheldError(),
      new policy.WorkspaceCreationContextChangedError(),
    ]) {
      mocks.create.mockRejectedValueOnce(error)
      expect(
        await routeExecution('workspaces', { action: 'create', name: 'Research' }, context)
      ).toMatchObject({ success: false })
    }
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('does not leak database details or emit success effects after a failed write', async () => {
    mocks.create.mockRejectedValueOnce(new Error('private database details'))
    expect(
      await routeExecution('workspaces', { action: 'create', name: 'Research' }, context)
    ).toEqual({ success: false, message: 'Workspace creation failed' })
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects forged, expired, or foreign application principals before the creation policy runs', async () => {
    for (const rejected of [
      { ...principal, organizationId: 'other' },
      { ...principal, expiresAt: new Date(0) },
      { ...principal, audience: 'sim:settings' },
      createSessionPrincipal({ userId: 'actor', sessionId: 'session' }),
    ]) {
      await expect(
        createOrganizationWorkspace.execute({
          principal: rejected,
          input: { organizationId: 'org', name: 'Research', skipDefaultWorkflow: false },
        })
      ).rejects.toThrow()
    }
    expect(readPolicy).not.toHaveBeenCalled()
  })

  it('does not accept an unregistered operation object in the domain adapter', async () => {
    const forged = {
      ...createOrganizationWorkspace,
      operation: { ...createOrganizationWorkspace.operation },
    }
    await expect(
      executeOrganizationWorkspaceUseCase(context, forged, {
        name: 'Research',
        skipDefaultWorkflow: false,
      })
    ).rejects.toThrow('Unregistered')
    expect(mocks.chat).not.toHaveBeenCalled()
  })
})
