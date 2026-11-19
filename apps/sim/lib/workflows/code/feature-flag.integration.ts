/**
 * Real PostgreSQL coverage for the organization rollout of workflows as code: with the hosted
 * `feature-flags` document allowlisting one organization, every source use case answers for that
 * organization's workspaces and refuses (`forbidden`) another organization's, whichever phase of
 * the use case checks the flag. The flag document goes through the real evaluation; only the
 * AppConfig fetch is replaced.
 */

import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, organization, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { mockFetchProfile } = vi.hoisted(() => ({ mockFetchProfile: vi.fn() }))

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/appconfig', () => ({ fetchAppConfigProfile: mockFetchProfile }))

import { computeEntitlements } from '@/lib/mothership/entitlements'
import { readSourceCatalog } from '@/lib/workflows/application/read-source-catalog'
import { readSourceResources } from '@/lib/workflows/application/read-source-resources'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'
import { findMissingSourceBlobs } from '@/lib/workspace-source/application/stage-blobs'

const rolledOut = { orgId: generateId(), ownerId: generateId(), workspaceId: generateId() }
const notRolledOut = { orgId: generateId(), ownerId: generateId(), workspaceId: generateId() }
const tenants = [rolledOut, notRolledOut]

type Tenant = typeof rolledOut

const useCases: Array<[string, (principal: Principal, workspaceId: string) => Promise<unknown>]> = [
  [
    'source resources',
    (principal, workspaceId) => readSourceResources.execute({ principal, input: { workspaceId } }),
  ],
  [
    'source catalog',
    (principal, workspaceId) => readSourceCatalog.execute({ principal, input: { workspaceId } }),
  ],
  [
    'workspace source',
    (principal, workspaceId) =>
      readWorkspaceSource.execute({ principal, input: { workspaceId, kinds: ['table'] } }),
  ],
  [
    'missing blobs',
    (principal, workspaceId) =>
      findMissingSourceBlobs.execute({ principal, input: { workspaceId, blobs: [] } }),
  ],
]

const ownerOf = (tenant: Tenant) =>
  createSessionPrincipal({ userId: tenant.ownerId, sessionId: generateId() })

describe('workflows as code rolled out to one organization', () => {
  beforeAll(async () => {
    setEnvFlags({ isAppConfigEnabled: true })
    mockFetchProfile.mockImplementation(async (_ids: unknown, parse: (doc: unknown) => unknown) =>
      parse({ 'workflow-code': { enabled: false, orgIds: [rolledOut.orgId] } })
    )
    const now = new Date()
    await db.insert(user).values(
      tenants.map((tenant) => ({
        id: tenant.ownerId,
        name: 'Workflow code rollout fixture',
        email: `${tenant.ownerId}@workflow-code-rollout.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values(
      tenants.map((tenant) => ({
        id: tenant.orgId,
        name: 'Workflow code rollout',
        slug: tenant.orgId,
        createdAt: now,
      }))
    )
    await db.insert(member).values(
      tenants.map((tenant) => ({
        id: generateId(),
        organizationId: tenant.orgId,
        userId: tenant.ownerId,
        role: 'owner',
        createdAt: now,
      }))
    )
    await insertWorkspaceFixture(
      db,
      tenants.map((tenant) => ({
        id: tenant.workspaceId,
        organizationId: tenant.orgId,
        workspaceMode: 'organization' as const,
        name: 'Workflow code rollout',
        ownerId: tenant.ownerId,
        billedAccountUserId: tenant.ownerId,
      }))
    )
    await db.insert(permissions).values(
      tenants.map((tenant) => ({
        id: generateId(),
        userId: tenant.ownerId,
        entityType: 'workspace' as const,
        entityId: tenant.workspaceId,
        permissionType: 'admin' as const,
      }))
    )
  })

  afterAll(async () => {
    const workspaceIds = tenants.map((tenant) => tenant.workspaceId)
    await db.delete(permissions).where(inArray(permissions.entityId, workspaceIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
    await db.delete(organization).where(
      inArray(
        organization.id,
        tenants.map((tenant) => tenant.orgId)
      )
    )
    await db.delete(user).where(
      inArray(
        user.id,
        tenants.map((tenant) => tenant.ownerId)
      )
    )
    resetEnvFlagsMock()
  })

  it.each(useCases)('answers %s in the rolled-out organization', async (_name, run) => {
    await expect(run(ownerOf(rolledOut), rolledOut.workspaceId)).resolves.toBeDefined()
  })

  it.each(useCases)('refuses %s in another organization', async (_name, run) => {
    await expect(run(ownerOf(notRolledOut), notRolledOut.workspaceId)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('answers a workspace API key, which has no user, by its workspace organization', async () => {
    const key = (tenant: Tenant) =>
      createWorkspaceApiKeyPrincipal({
        workspaceId: tenant.workspaceId,
        keyId: generateId(),
        access: 'read',
      })

    await expect(
      readSourceResources.execute({
        principal: key(rolledOut),
        input: { workspaceId: rolledOut.workspaceId },
      })
    ).resolves.toBeDefined()
    await expect(
      readSourceResources.execute({
        principal: key(notRolledOut),
        input: { workspaceId: notRolledOut.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('grants a chat the workflow-code entitlement only where the source commands would run', async () => {
    const granted = async (owner: Parameters<typeof computeEntitlements>[0]) =>
      (await computeEntitlements(owner)).includes('workflow-code')

    expect(
      await granted({ principal: ownerOf(rolledOut), workspaceId: rolledOut.workspaceId })
    ).toBe(true)
    expect(
      await granted({ principal: ownerOf(notRolledOut), workspaceId: notRolledOut.workspaceId })
    ).toBe(false)
    expect(await granted({ principal: ownerOf(rolledOut), organizationId: rolledOut.orgId })).toBe(
      true
    )
    expect(
      await granted({ principal: ownerOf(notRolledOut), organizationId: notRolledOut.orgId })
    ).toBe(false)
  })
})
