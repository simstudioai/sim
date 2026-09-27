import { BUILTIN_SKILLS, isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import type { SkillDefinition } from '@/hooks/queries/skills'

/** Built-ins are global templates; only user-defined skills carry a workspace. */
export function organizationSkillOptions(
  workspaces: ReadonlyArray<{
    id: string
    name: string
    skills: readonly SkillDefinition[]
  }>
): (SkillDefinition & { workspaceName?: string })[] {
  return [
    ...BUILTIN_SKILLS.map((skill) => ({
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
