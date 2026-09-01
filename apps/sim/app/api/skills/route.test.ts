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

const otherSkillRow = { ...skillRow, id: 'skill-2', name: 'shipping-policy' }

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
   * The semantic audit entry is projected by the application use case and is
   * tagged with the operation id. A surface that writes through the manager
   * directly cannot produce it. The batch is one operation, `skills.upsert`;
   * the create/update distinction stays on the audit action.
   */
  it('records the skills.upsert semantic audit entry for an update', async () => {
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
        metadata: expect.objectContaining({ operation: 'skills.upsert' }),
      })
    )
  })

  it('records a skill.created audit entry for a create', async () => {
    mocks.upsertSkills.mockResolvedValue({
      touched: [{ id: 'skill-2', name: 'new-skill', operation: 'created' }],
    })

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
        resourceId: 'skill-2',
        metadata: expect.objectContaining({ operation: 'skills.upsert' }),
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

  it('commits a valid batch in one write with one audit entry per skill', async () => {
    mocks.upsertSkills.mockResolvedValue({
      touched: [
        { id: skillRow.id, name: skillRow.name, operation: 'updated' },
        { id: 'skill-3', name: 'new-skill', operation: 'created' },
      ],
    })

    const response = await POST(
      upsertRequest({
        workspaceId: WORKSPACE_ID,
        skills: [
          { id: skillRow.id, content: '# Updated' },
          { name: 'new-skill', description: 'A skill', content: '# New' },
        ],
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.upsertSkills).toHaveBeenCalledTimes(1)
    expect(mocks.upsertSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: [
          { id: skillRow.id, content: '# Updated' },
          { name: 'new-skill', description: 'A skill', content: '# New' },
        ],
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledTimes(2)
    expect(mocks.recordAudit.mock.calls.map(([entry]) => [entry.action, entry.resourceId])).toEqual(
      [
        ['skill.updated', skillRow.id],
        ['skill.created', 'skill-3'],
      ]
    )
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
