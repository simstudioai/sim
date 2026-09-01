/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSkillActorContext, mockUpsertSkills, mockGetSkillById, mockDeleteSkill } =
  vi.hoisted(() => ({
    mockGetSkillActorContext: vi.fn(),
    mockUpsertSkills: vi.fn(),
    mockGetSkillById: vi.fn(),
    mockDeleteSkill: vi.fn(),
  }))

vi.mock('@/lib/skills/access', () => ({
  getSkillActorContext: mockGetSkillActorContext,
}))

vi.mock('@/lib/workflows/skills/operations', () => ({
  upsertSkills: mockUpsertSkills,
  getSkillById: mockGetSkillById,
  deleteSkill: mockDeleteSkill,
}))

import { createSkill, updateSkill } from '@/lib/skills/orchestration/skill-lifecycle'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const SKILL_ID = '33333333-3333-4333-8333-333333333333'

/** `research` is one of the shipped built-in skill names. */
const BUILTIN_NAME = 'research'

function skillRow(name: string) {
  return {
    id: SKILL_ID,
    workspaceId: WORKSPACE_ID,
    name,
    description: 'desc',
    content: 'content',
  }
}

function actorOwning(name: string) {
  return { skill: skillRow(name), hasWorkspaceAccess: true, canEdit: true }
}

describe('skill lifecycle built-in name collision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpsertSkills.mockResolvedValue({ touched: [{ id: SKILL_ID, name: 'x' }] })
    mockGetSkillById.mockResolvedValue(skillRow(BUILTIN_NAME))
  })

  it('allows an update that re-sends an existing built-in-colliding name unchanged', async () => {
    mockGetSkillActorContext.mockResolvedValue(actorOwning(BUILTIN_NAME))

    const row = await updateSkill({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      skillId: SKILL_ID,
      name: BUILTIN_NAME,
      description: 'updated description',
      content: 'updated content',
    })

    expect(row.name).toBe(BUILTIN_NAME)
    expect(mockUpsertSkills).toHaveBeenCalledTimes(1)
  })

  it('rejects renaming a skill into a built-in name', async () => {
    mockGetSkillActorContext.mockResolvedValue(actorOwning('my-skill'))

    await expect(
      updateSkill({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        skillId: SKILL_ID,
        name: BUILTIN_NAME,
      })
    ).rejects.toThrow(`The skill name "${BUILTIN_NAME}" is reserved by a built-in skill`)

    expect(mockUpsertSkills).not.toHaveBeenCalled()
  })

  it('rejects creating a skill with a built-in name', async () => {
    await expect(
      createSkill({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        name: BUILTIN_NAME,
        description: 'desc',
        content: 'content',
      })
    ).rejects.toThrow(`The skill name "${BUILTIN_NAME}" is reserved by a built-in skill`)

    expect(mockUpsertSkills).not.toHaveBeenCalled()
  })
})
