import { createMockRequest } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { hybridAuthMockFns } from '@sim/testing/mocks/hybrid-auth.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getSkillById: vi.fn(),
  upsertSkills: vi.fn(),
  listSkillsForUser: vi.fn(),
  listSkills: vi.fn(),
  deleteSkill: vi.fn(),
  getSkillActorContext: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/workflows/skills/operations', () => ({
  getSkillById: hoisted.getSkillById,
  upsertSkills: hoisted.upsertSkills,
  listSkillsForUser: hoisted.listSkillsForUser,
  listSkills: hoisted.listSkills,
  deleteSkill: hoisted.deleteSkill,
}))
vi.mock('@/lib/skills/access', () => ({
  getSkillActorContext: hoisted.getSkillActorContext,
}))
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from '@/app/api/skills/route'

const mocks = {
  ...hoisted,
  getSession: authMockFns.mockGetSession,
  /**
   * Kept authenticated independently of which auth helper the route reaches for,
   * so a failure here can only be about where the authorization decision and the
   * audit entry are made.
   */
  checkSessionOrInternalAuth: hybridAuthMockFns.mockCheckSessionOrInternalAuth,
  loadActiveWorkspaceContext: workspaceUploadsMockFns.mockLoadActiveWorkspaceContext,
  resolveEffectiveWorkspacePermission:
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  recordAudit: auditMockFns.mockRecordAudit,
  captureServerEvent: posthogServerMockFns.mockCaptureServerEvent,
  checkWorkspaceAccess: permissionsMockFns.mockCheckWorkspaceAccess,
}

const WORKSPACE_ID = 'workspace-1'
const USER_ID = 'user-1'

const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}

const skillRow = {
  id: 'skill-1',
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  name: 'refund-policy',
  description: 'Refund rules',
  content: '# Refunds',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

const otherSkillRow = { ...skillRow, id: 'skill-2', name: 'shipping-policy' }

function upsertRequest(body: unknown) {
  return createMockRequest('POST', body, {}, 'http://localhost:3000/api/skills')
}

describe('internal /api/skills route', () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({
      user: { id: USER_ID, name: 'Ada', email: 'ada@example.com' },
      session: { id: 'session-1' },
    })
    mocks.checkSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: USER_ID,
      userName: 'Ada',
      userEmail: 'ada@example.com',
      authType: 'session',
    })
    mocks.loadActiveWorkspaceContext.mockResolvedValue(workspaceContext)
    mocks.resolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    mocks.getSkillById.mockImplementation(async ({ skillId }: { skillId: string }) =>
      skillId === otherSkillRow.id ? otherSkillRow : skillRow
    )
    mocks.upsertSkills.mockResolvedValue({
      touched: [{ id: skillRow.id, name: skillRow.name, operation: 'updated' }],
    })
    mocks.listSkillsForUser.mockResolvedValue([{ ...skillRow, canEdit: true }])
    mocks.deleteSkill.mockResolvedValue(true)
    mocks.getSkillActorContext.mockResolvedValue({
      skill: skillRow,
      hasWorkspaceAccess: true,
      canEdit: true,
    })
    mocks.checkWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: true,
      workspace: { id: WORKSPACE_ID },
      permission: 'admin',
    })
  })

  /**
   * Canonical workspace context is loaded by the use case, so an update aimed
   * at a workspace that no longer exists is refused before any write.
   */
  it('refuses an update when the canonical workspace context is gone', async () => {
    mocks.loadActiveWorkspaceContext.mockResolvedValue(null)

    const response = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [{ id: skillRow.id, content: '# Updated' }],
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace not found' })
    expect(mocks.upsertSkills).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('refuses an update when the caller holds no workspace permission', async () => {
    mocks.resolveEffectiveWorkspacePermission.mockResolvedValue(null)

    const response = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [{ id: skillRow.id, content: '# Updated' }],
      })
    )

    expect(response.status).toBe(403)
    expect(mocks.upsertSkills).not.toHaveBeenCalled()
  })

  /**
   * The batch is one operation. A rejected item must leave the items before it
   * unwritten and unaudited rather than half-committing the request.
   */
  it('writes and audits nothing when a later item in the batch is rejected', async () => {
    mocks.getSkillActorContext.mockImplementation(async (skillId: string) =>
      skillId === skillRow.id
        ? { skill: skillRow, hasWorkspaceAccess: true, canEdit: true }
        : { skill: otherSkillRow, hasWorkspaceAccess: true, canEdit: false }
    )

    const response = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [
          { id: skillRow.id, content: '# Updated' },
          { id: otherSkillRow.id, content: '# Also updated' },
        ],
      })
    )

    expect(response.status).toBe(403)
    expect(mocks.upsertSkills).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  /**
   * The batch operation declares only the read floor an update needs, so a
   * skill editor without workspace write keeps editing. A create in the same
   * request is still gated on workspace write, before anything is written.
   */
  it('lets a read-only skill editor update but refuses a create', async () => {
    mocks.resolveEffectiveWorkspacePermission.mockResolvedValue('read')

    const updated = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [{ id: skillRow.id, content: '# Updated' }],
      })
    )
    expect(updated.status).toBe(200)

    mocks.upsertSkills.mockClear()
    const created = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [{ name: 'new-skill', description: 'A skill', content: '# New' }],
      })
    )

    expect(created.status).toBe(403)
    expect(mocks.upsertSkills).not.toHaveBeenCalled()
  })

  /**
   * The create escalation runs ahead of the write, so a mixed batch a
   * read-only editor may not fully perform lands nothing at all.
   */
  it('writes nothing when only the create half of a mixed batch is unauthorized', async () => {
    mocks.resolveEffectiveWorkspacePermission.mockResolvedValue('read')

    const response = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [
          { id: skillRow.id, content: '# Updated' },
          { name: 'new-skill', description: 'A skill', content: '# New' },
        ],
      })
    )

    expect(response.status).toBe(403)
    expect(mocks.upsertSkills).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
