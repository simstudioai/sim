import { BUILTIN_SKILLS, isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import type { SkillDefinition } from '@/hooks/queries/skills'

/**
 * Built-ins are global templates; only user-defined skills carry a workspace. Rollout-gated
 * built-ins (the dashboard skill) are excluded the same way the server skill lists exclude them.
 */
export function organizationSkillOptions(
  workspaces: ReadonlyArray<{
    id: string
    name: string
    skills: readonly SkillDefinition[]
  }>,
  excludedBuiltinIds: readonly string[] = []
): (SkillDefinition & { workspaceName?: string })[] {
  return [
    ...BUILTIN_SKILLS.filter((skill) => !excludedBuiltinIds.includes(skill.id)).map((skill) => ({
      ...skill,
      workspaceId: null,
      userId: null,
      canEdit: false,
      readOnly: true,
      createdAt: '',
      updatedAt: '',
    })),
    ...workspaces.flatMap((workspace) =>
      workspace.skills
        .filter((skill) => !isBuiltinSkillId(skill.id))
        .map((skill) => ({
          ...skill,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        }))
    ),
  ]
}
