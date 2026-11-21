/**
 * Real PostgreSQL coverage for the workbench's `SIM_ENTITLEMENTS`: a Mothership Function
 * execution carries a Copilot delegation scoped to Function executions, and the availability use
 * cases behind each entitlement authorize it for real. Only the workbench transport (CLI bundle,
 * worker bootstrap, callback endpoint) and the AppConfig fetch are replaced.
 */

import { db } from '@sim/db'
import { member, organization, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  mothershipWorkerFetchMock,
  mothershipWorkerFetchMockFns,
} from '@sim/testing/mocks/mothership-worker-fetch.mock'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { mockFetchProfile } = vi.hoisted(() => ({ mockFetchProfile: vi.fn() }))

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/appconfig', () => ({ fetchAppConfigProfile: mockFetchProfile }))
vi.mock('node:fs/promises', () => ({ readFile: async () => 'runtime' }))
vi.mock('@/lib/mothership/transport/connection', () => ({
  getSimConnection: () => ({ mode: 'direct' }),
}))
vi.mock('@/lib/mothership/request/worker/fetch', () => mothershipWorkerFetchMock)
vi.mock('@/lib/mothership/request/headers', () => ({ mothershipRequestHeaders: () => ({}) }))
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)
vi.mock('@/lib/mothership/tools/sandbox-resources', () => ({
  sandboxResourceEndpoint: async (url: string) => `${url}/api/mothership/sandbox/owned-token`,
  activeSandboxChatOwner: () => undefined,
  activeSandboxFileOwnerProtocol: () => undefined,
  activeSandboxWorkspaceFileCopy: () => undefined,
}))

import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { buildMothershipSandboxSession } from '@/lib/mothership/tools/sandbox-session'

const tenant = { orgId: generateId(), ownerId: generateId(), workspaceId: generateId() }
const notRolledOut = { orgId: generateId(), ownerId: generateId(), workspaceId: generateId() }
const tenants = [tenant, notRolledOut]
const chatId = generateId()

/** The principal `lib/internal/function/execute.ts` builds for a workspace Copilot run. */
function workspaceExecutionPrincipal(owner = tenant) {
  const issuedAt = new Date()
  return {
    kind: 'delegated' as const,
    serviceId: 'copilot' as const,
    subjectUserId: owner.ownerId,
    workspaceId: owner.workspaceId,
    delegationId: `function-execute:${generateId()}`,
    audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 60_000),
    resourceScope: { executionId: generateId() },
  }
}

describe('workbench entitlements for a Mothership Function execution', () => {
  beforeAll(async () => {
    setEnvFlags({ isAppConfigEnabled: true })
    mockFetchProfile.mockImplementation(async (_ids: unknown, parse: (doc: unknown) => unknown) =>
      parse({ 'workflow-code': { enabled: false, orgIds: [tenant.orgId] } })
    )
    mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue('https://worker.test')
    mothershipWorkerFetchMockFns.mockFetchWorker.mockImplementation(async () =>
      Response.json({ version: 1, entrypoint: 'entry' })
    )
    const now = new Date()
    await db.insert(user).values(
      tenants.map((owner) => ({
        id: owner.ownerId,
        name: 'Sandbox entitlements fixture',
        email: `${owner.ownerId}@sandbox-entitlements.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values(
      tenants.map((owner) => ({
        id: owner.orgId,
        name: 'Sandbox entitlements',
        slug: owner.orgId,
        createdAt: now,
      }))
    )
    await db.insert(member).values(
      tenants.map((owner) => ({
        id: generateId(),
        organizationId: owner.orgId,
        userId: owner.ownerId,
        role: 'owner',
        createdAt: now,
      }))
    )
    await insertWorkspaceFixture(
      db,
      tenants.map((owner) => ({
        id: owner.workspaceId,
        organizationId: owner.orgId,
        workspaceMode: 'organization' as const,
        name: 'Sandbox entitlements',
        ownerId: owner.ownerId,
        billedAccountUserId: owner.ownerId,
      }))
    )
    await db.insert(permissions).values(
      tenants.map((owner) => ({
        id: generateId(),
        userId: owner.ownerId,
        entityType: 'workspace' as const,
        entityId: owner.workspaceId,
        permissionType: 'admin' as const,
      }))
    )
  })

  afterAll(async () => {
    const workspaceIds = tenants.map((owner) => owner.workspaceId)
    await db.delete(permissions).where(inArray(permissions.entityId, workspaceIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
    await db.delete(organization).where(
      inArray(
        organization.id,
        tenants.map((owner) => owner.orgId)
      )
    )
    await db.delete(user).where(
      inArray(
        user.id,
        tenants.map((owner) => owner.ownerId)
      )
    )
    resetEnvFlagsMock()
  })

  it('grants a workspace chat workflow-code through its Function delegation', async () => {
    const session = await buildMothershipSandboxSession({
      sessionKey: chatId,
      workspaceId: tenant.workspaceId,
      userId: tenant.ownerId,
      principal: workspaceExecutionPrincipal(),
    })
    expect(session.envs?.SIM_WORKSPACE).toBe(tenant.workspaceId)
    expect((session.envs?.SIM_ENTITLEMENTS ?? '').split(',')).toContain('workflow-code')
  })

  it('grants an organization chat workflow-code through its Function delegation', async () => {
    const session = await buildMothershipSandboxSession({
      sessionKey: chatId,
      organizationId: tenant.orgId,
      userId: tenant.ownerId,
      principal: createTrustedOrganizationCopilotPrincipal(
        {
          userId: tenant.ownerId,
          organizationId: tenant.orgId,
          chatId,
          delegationId: `function-execute:${generateId()}`,
        },
        { audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE, ttlMs: 60_000 }
      ),
    })
    expect(session.envs?.SIM_ORGANIZATION_ID).toBe(tenant.orgId)
    expect((session.envs?.SIM_ENTITLEMENTS ?? '').split(',')).toContain('workflow-code')
  })

  it('omits workflow-code where the workspace is not rolled out', async () => {
    const session = await buildMothershipSandboxSession({
      sessionKey: chatId,
      workspaceId: notRolledOut.workspaceId,
      userId: notRolledOut.ownerId,
      principal: workspaceExecutionPrincipal(notRolledOut),
    })
    expect(session.envs?.SIM_WORKSPACE).toBe(notRolledOut.workspaceId)
    expect(session.envs?.SIM_ENTITLEMENTS ?? '').not.toContain('workflow-code')
  })
})
