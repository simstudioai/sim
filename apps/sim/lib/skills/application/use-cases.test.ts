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

import { updateSkillUseCase } from '@/lib/skills/application/use-cases'

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
