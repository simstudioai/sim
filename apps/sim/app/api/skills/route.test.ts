/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getSession: vi.fn(),
    loadActiveWorkspaceContext: vi.fn(),
    resolveEffectiveWorkspacePermission: vi.fn(),
    recordAudit: vi.fn(),
    getSkillById: vi.fn(),
    upsertSkills: vi.fn(),
    listSkillsForUser: vi.fn(),
    listSkills: vi.fn(),
    deleteSkill: vi.fn(),
    getSkillActorContext: vi.fn(),
    captureServerEvent: vi.fn(),
    checkWorkspaceAccess: vi.fn(),
    checkSessionOrInternalAuth: vi.fn(),
  },
}))

/**
 * Kept authenticated independently of which auth helper the route reaches for,
 * so a failure here can only be about where the authorization decision and the
 * audit entry are made.
 */
vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: { SESSION: 'session', API_KEY: 'api_key', INTERNAL_JWT: 'internal_jwt' },
  checkSessionOrInternalAuth: mocks.checkSessionOrInternalAuth,
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mocks.getSession,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  loadActiveWorkspaceContext: mocks.loadActiveWorkspaceContext,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolveEffectiveWorkspacePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    SKILL_CREATED: 'skill.created',
    SKILL_UPDATED: 'skill.updated',
    SKILL_DELETED: 'skill.deleted',
  },
  AuditResourceType: { SKILL: 'skill' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@/lib/workflows/skills/operations', () => ({
  getSkillById: mocks.getSkillById,
  upsertSkills: mocks.upsertSkills,
  listSkillsForUser: mocks.listSkillsForUser,
  listSkills: mocks.listSkills,
  deleteSkill: mocks.deleteSkill,
}))
vi.mock('@/lib/skills/access', () => ({
  getSkillActorContext: mocks.getSkillActorContext,
}))
vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mocks.captureServerEvent,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
}))

import { DELETE, POST } from '@/app/api/skills/route'

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

function upsertRequest(body: unknown) {
  return createMockRequest('POST', body, {}, 'http://localhost:3000/api/skills')
}

describe('internal /api/skills route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mocks.getSkillById.mockResolvedValue(skillRow)
    mocks.upsertSkills.mockResolvedValue({ touched: [{ id: skillRow.id, name: skillRow.name }] })
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
   * The semantic audit entry is projected by the application use case and is
   * tagged with the operation id. A surface that writes through the manager
   * directly cannot produce it.
   */
  it('records the skills.update semantic audit entry for an update', async () => {
    const response = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [{ id: skillRow.id, content: '# Updated' }],
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        actorId: USER_ID,
        action: 'skill.updated',
        resourceId: skillRow.id,
        metadata: expect.objectContaining({ operation: 'skills.update' }),
      })
    )
  })

  it('records the skills.create semantic audit entry for a create', async () => {
    const response = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [{ name: 'new-skill', description: 'A skill', content: '# New' }],
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skill.created',
        metadata: expect.objectContaining({ operation: 'skills.create' }),
      })
    )
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

  it('records the skills.delete semantic audit entry', async () => {
    const response = await DELETE(
      createMockRequest(
        'DELETE',
        undefined,
        {},
        `http://localhost:3000/api/skills?id=${skillRow.id}&workspaceId=${WORKSPACE_ID}`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skill.deleted',
        metadata: expect.objectContaining({ operation: 'skills.delete' }),
      })
    )
  })

  it('still emits product analytics for a write', async () => {
    await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [{ id: skillRow.id, content: '# Updated' }],
        source: 'settings',
      })
    )

    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      USER_ID,
      'skill_updated',
      expect.objectContaining({
        skill_id: skillRow.id,
        workspace_id: WORKSPACE_ID,
        source: 'settings',
      }),
      { groups: { workspace: WORKSPACE_ID } }
    )
  })
})
