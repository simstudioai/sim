import { expect, it } from 'vitest'
import { BUILTIN_SKILLS } from '@/lib/workflows/skills/builtin-skills'
import { organizationSkillOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/organization-skill-options'

it('offers each canonical global built-in once, including without any workspaces', () => {
  const global = organizationSkillOptions([])
  expect(global.map((skill) => skill.id)).toEqual(BUILTIN_SKILLS.map((skill) => skill.id))
  const result = organizationSkillOptions([
    { id: 'sales', name: 'Sales', skills: global },
    { id: 'finance', name: 'Finance', skills: global },
  ])
  expect(result).toEqual(global)
  expect(result.every((skill) => skill.workspaceId === null && !skill.workspaceName)).toBe(true)
})
it('retains custom skills with the same name as scoped options', () => {
  const skill = {
    ...organizationSkillOptions([])[0],
    id: 'custom',
    name: 'Custom',
    readOnly: false,
  }
  const result = organizationSkillOptions([
    { id: 'sales', name: 'Sales', skills: [skill] },
    { id: 'finance', name: 'Finance', skills: [skill] },
  ]).filter((item) => item.id === 'custom')
  expect(
    result.map(({ name, workspaceId, workspaceName }) => ({ name, workspaceId, workspaceName }))
  ).toEqual([
    { name: 'Custom', workspaceId: 'sales', workspaceName: 'Sales' },
    { name: 'Custom', workspaceId: 'finance', workspaceName: 'Finance' },
  ])
})
