/**
 * @vitest-environment node
 */
import { skill } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  getActor: vi.fn(),
  listEditors: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  recordAudit: vi.fn(),
  getSkillById: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    SKILL_CREATED: 'skill.created',
    SKILL_UPDATED: 'skill.updated',
    SKILL_DELETED: 'skill.deleted',
    SKILL_MEMBER_ADDED: 'skill.member_added',
    SKILL_MEMBER_REMOVED: 'skill.member_removed',
  },
  AuditResourceType: { SKILL: 'skill' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  loadActiveWorkspaceContext: mocks.loadWorkspace,
}))

vi.mock('@/lib/skills/access', () => ({
  getSkillActorContext: mocks.getActor,
  listSkillEditors: mocks.listEditors,
}))

vi.mock('@/lib/skills/orchestration', () => ({
  createSkill: vi.fn(),
  deleteSkillRecord: vi.fn(),
  updateSkill: vi.fn(),
  upsertSkillBatch: vi.fn(),
}))

vi.mock('@/lib/workflows/skills/operations', () => ({
  getSkillById: mocks.getSkillById,
  listSkillSummariesPage: vi.fn(),
  listSkillsForUser: vi.fn(),
}))

vi.mock('@/lib/workflows/skills/builtin-skills', () => ({
  isBuiltinSkillId: (id: string) => id.startsWith('builtin-'),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUsersWithPermissions: mocks.listWorkspaceMembers,
}))

import {
  grantSkillEditorUseCase,
  listSkillEditorsUseCase,
  revokeSkillEditorUseCase,
} from '@/lib/skills/application/use-cases'

const WORKSPACE_ID = 'workspace-1'
const SKILL_ID = 'skill-1'
const ACTOR_ID = 'user-1'
const TARGET_ID = 'user-2'
const TARGET_EMAIL = 'ada@example.com'
const principal = { kind: 'personal_api_key' as const, userId: ACTOR_ID, keyId: 'key-1' }
const skillRow = {
  id: SKILL_ID,
  workspaceId: WORKSPACE_ID,
  userId: ACTOR_ID,
  name: 'research',
  description: 'Research instructions',
  content: 'Investigate the topic.',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const targetMember = {
  userId: TARGET_ID,
  email: TARGET_EMAIL,
  name: 'Ada',
  image: null,
  permissionType: 'write',
  isExternal: false,
  joinedAt: '2026-01-01T00:00:00.000Z',
  roleSource: 'explicit',
  isOrgAdmin: false,
  isBilledAccount: false,
}
const targetEditor = {
  id: 'skill-member-1',
  userId: TARGET_ID,
  userName: targetMember.name,
  userEmail: targetMember.email,
  userImage: targetMember.image,
  isWorkspaceAdmin: false,
}

function queueSkill(): void {
  queueTableRows(skill, [skillRow])
}

describe('skill editor application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getActor.mockResolvedValue({
      skill: skillRow,
      hasWorkspaceAccess: true,
      canEdit: true,
    })
    mocks.listEditors.mockResolvedValue([])
    mocks.listWorkspaceMembers.mockResolvedValue([targetMember])
  })

  afterAll(resetDbChainMock)

  it('lists and paginates the full editor roster after workspace authorization', async () => {
    queueSkill()
    mocks.listEditors.mockResolvedValue([
      targetEditor,
      {
        ...targetEditor,
        id: 'workspace-admin-user-3',
        userId: 'user-3',
        userName: 'Grace',
        userEmail: 'grace@example.com',
        isWorkspaceAdmin: true,
      },
    ])

    const result = await listSkillEditorsUseCase.execute({
      principal,
      input: {
        workspaceId: WORKSPACE_ID,
        skillId: SKILL_ID,
        sortBy: 'name',
        sortOrder: 'desc',
        limit: 1,
        offset: 0,
      },
    })

    expect(result.editors.map(({ userName }) => userName)).toEqual(['Grace'])
    expect(result.hasMore).toBe(true)
    expect(mocks.resolvePermission).toHaveBeenCalled()
  })

  it('creates an explicit grant and audits the authoritative result', async () => {
    queueSkill()
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: targetEditor.id }])

    const result = await grantSkillEditorUseCase.execute({
      principal,
      input: {
        workspaceId: WORKSPACE_ID,
        skillId: SKILL_ID,
        target: { kind: 'email', email: TARGET_EMAIL },
      },
    })

    expect(result).toMatchObject({ created: true, editor: targetEditor })
    expect(dbChainMockFns.insert).toHaveBeenCalled()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        action: 'skill.member_added',
        metadata: expect.objectContaining({ targetUserId: TARGET_ID }),
      })
    )
  })

  it('treats an existing editor grant as an unaudited idempotent success', async () => {
    queueSkill()
    mocks.listEditors.mockResolvedValue([targetEditor])

    const result = await grantSkillEditorUseCase.execute({
      principal,
      input: {
        workspaceId: WORKSPACE_ID,
        skillId: SKILL_ID,
        target: { kind: 'email', email: TARGET_EMAIL },
      },
    })

    expect(result.created).toBe(false)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('requires the actor to be a current editor before resolving the target', async () => {
    queueSkill()
    mocks.getActor.mockResolvedValue({
      skill: skillRow,
      hasWorkspaceAccess: true,
      canEdit: false,
    })

    await expect(
      grantSkillEditorUseCase.execute({
        principal,
        input: {
          workspaceId: WORKSPACE_ID,
          skillId: SKILL_ID,
          target: { kind: 'email', email: TARGET_EMAIL },
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden', detailCode: 'SKILL_EDITOR_ACCESS_REQUIRED' })

    expect(mocks.listWorkspaceMembers).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('refuses explicit grants for derived workspace administrators', async () => {
    queueSkill()
    mocks.listWorkspaceMembers.mockResolvedValue([
      { ...targetMember, permissionType: 'admin', roleSource: 'org-admin', isOrgAdmin: true },
    ])

    await expect(
      grantSkillEditorUseCase.execute({
        principal,
        input: {
          workspaceId: WORKSPACE_ID,
          skillId: SKILL_ID,
          target: { kind: 'email', email: TARGET_EMAIL },
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('returns not-found when revoking a member without an explicit grant', async () => {
    queueSkill()

    await expect(
      revokeSkillEditorUseCase.execute({
        principal,
        input: {
          workspaceId: WORKSPACE_ID,
          skillId: SKILL_ID,
          target: { kind: 'email', email: TARGET_EMAIL },
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(dbChainMockFns.delete).toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('conceals an asserted workspace mismatch before workspace authorization', async () => {
    queueSkill()

    await expect(
      listSkillEditorsUseCase.execute({
        principal,
        input: {
          workspaceId: 'workspace-2',
          skillId: SKILL_ID,
          sortBy: 'email',
          sortOrder: 'asc',
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
  })

  /**
   * A built-in skill is materialized from code, so `skills get` and `skills
   * list` both return it. Reporting it as missing from the editor verbs
   * contradicted that: the read and the writes disagree about what is possible,
   * not about what exists.
   */
  describe('built-in skills', () => {
    const BUILTIN_ID = 'builtin-research'

    beforeEach(() => {
      mocks.getSkillById.mockResolvedValue({ ...skillRow, id: BUILTIN_ID })
    })

    it('lists an empty editor roster rather than refusing the read', async () => {
      const result = await listSkillEditorsUseCase.execute({
        principal,
        input: {
          workspaceId: WORKSPACE_ID,
          skillId: BUILTIN_ID,
          sortBy: 'email',
          sortOrder: 'asc',
        },
      })

      expect(result).toMatchObject({ editors: [], hasMore: false })
      expect(mocks.listEditors).not.toHaveBeenCalled()
      expect(mocks.resolvePermission).toHaveBeenCalled()
    })

    it('refuses a grant as read-only rather than as missing', async () => {
      await expect(
        grantSkillEditorUseCase.execute({
          principal,
          input: {
            workspaceId: WORKSPACE_ID,
            skillId: BUILTIN_ID,
            target: { kind: 'email', email: TARGET_EMAIL },
          },
        })
      ).rejects.toMatchObject({
        code: 'validation',
        message: 'Built-in skills are read-only and cannot be modified',
      })
    })

    it('refuses a revoke as read-only rather than as missing', async () => {
      await expect(
        revokeSkillEditorUseCase.execute({
          principal,
          input: {
            workspaceId: WORKSPACE_ID,
            skillId: BUILTIN_ID,
            target: { kind: 'email', email: TARGET_EMAIL },
          },
        })
      ).rejects.toMatchObject({
        code: 'validation',
        message: 'Built-in skills are read-only and cannot be modified',
      })
    })

    /**
     * The internal members route maps no workspace id, so the list used to fall
     * through to the mutation resolver and answer a read with the read-only
     * refusal — the same incoherence the empty roster was added to remove.
     */
    it('never answers a workspace-less list with the read-only refusal', async () => {
      await expect(
        listSkillEditorsUseCase.execute({
          principal,
          input: { skillId: BUILTIN_ID, sortBy: 'email', sortOrder: 'asc' },
        })
      ).rejects.toMatchObject({
        code: 'validation',
        message: 'workspaceId is required to list the editors of a built-in skill',
      })

      expect(mocks.loadWorkspace).not.toHaveBeenCalled()
      expect(mocks.listEditors).not.toHaveBeenCalled()
    })
  })
})
