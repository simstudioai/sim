import { expect, it } from 'vitest'
import { organizationSkillOptions } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/organization-skill-options'

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
