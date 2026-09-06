/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    loadContext: vi.fn(),
    resolvePermission: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    audit: vi.fn(),
  },
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  loadActiveWorkspaceContext: mocks.loadContext,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    SKILL_CREATED: 'skill.created',
    SKILL_UPDATED: 'skill.updated',
    SKILL_DELETED: 'skill.deleted',
  },
  AuditResourceType: { SKILL: 'skill' },
  recordAudit: mocks.audit,
}))
vi.mock('@/lib/skills/orchestration', () => ({
  createSkill: vi.fn(),
  deleteSkillRecord: vi.fn(),
  updateSkill: mocks.update,
}))
vi.mock('@/lib/workflows/skills/operations', () => ({
  getSkillById: mocks.getById,
  listSkills: vi.fn(),
  listSkillsForUser: vi.fn(),
}))

import { getSkillUseCase, updateSkillUseCase } from '@/lib/skills/application/use-cases'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}
const skill = {
  id: 'skill-1',
  workspaceId: workspace.workspaceId,
  userId: 'user-1',
  name: 'refund-policy',
  description: 'Refund rules',
  content: '# Refunds',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

describe('skill application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getById.mockResolvedValue(skill)
    mocks.update.mockResolvedValue({ ...skill, content: '# Updated' })
  })

  it.each(['skill-1', 'builtin-research'])(
    'reads %s with read permission in the asserted workspace',
    async (skillId) => {
      mocks.getById.mockResolvedValueOnce({ ...skill, id: skillId })
      const result = await getSkillUseCase.execute({
        principal: { kind: 'personal_api_key', userId: 'reader', keyId: 'key-1' },
        input: { workspaceId: workspace.workspaceId, skillId },
      })
      expect(result.skill.id).toBe(skillId)
      expect(mocks.getById).toHaveBeenCalledExactlyOnceWith({
        workspaceId: workspace.workspaceId,
        skillId,
      })
      expect(mocks.resolvePermission).toHaveBeenCalledWith(
        'reader',
        workspace.workspaceId,
        null,
        undefined,
        { forUpdate: undefined }
      )
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    }
  )

  it('does not return skill contents after access is revoked', async () => {
    mocks.resolvePermission.mockResolvedValueOnce(null)
    await expect(
      getSkillUseCase.execute({
        principal: { kind: 'session', userId: 'reader' },
        input: { workspaceId: workspace.workspaceId, skillId: skill.id },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('distinguishes an absent scoped skill from a lookup outage', async () => {
    const args = {
      principal: { kind: 'session' as const, userId: 'reader' },
      input: { workspaceId: workspace.workspaceId, skillId: 'foreign' },
    }
    mocks.getById.mockResolvedValueOnce(null)
    await expect(getSkillUseCase.execute(args)).rejects.toMatchObject({ code: 'not_found' })
    mocks.getById.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(getSkillUseCase.execute(args)).rejects.toThrow('database unavailable')
  })

  it('rejects workspace keys before resolving protected skill state', async () => {
    await expect(
      updateSkillUseCase.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: workspace.workspaceId,
          keyId: 'workspace-key-1',
        },
        input: { workspaceId: workspace.workspaceId, skillId: skill.id, content: '# Updated' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadContext).not.toHaveBeenCalled()
    expect(mocks.getById).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('uses the subject identity and semantic audit for delegated Copilot updates', async () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'user-1',
      workspaceId: workspace.workspaceId,
      delegationId: 'copilot-tool:call-1',
      audience: 'sim:skills',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      resourceScope: { chatId: 'chat-1' },
    }

    await updateSkillUseCase.execute({
      principal,
      input: {
        workspaceId: workspace.workspaceId,
        skillId: skill.id,
        content: '# Updated',
        source: 'tool_input',
      },
    })

    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      workspace.workspaceId,
      null,
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.update).toHaveBeenCalledWith({
      workspaceId: workspace.workspaceId,
      userId: 'user-1',
      skillId: skill.id,
      name: undefined,
      description: undefined,
      content: '# Updated',
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        metadata: expect.objectContaining({
          operation: 'skills.update',
          actor: expect.objectContaining({
            kind: 'delegated',
            delegationId: principal.delegationId,
          }),
        }),
      })
    )
  })
})
