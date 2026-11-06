import 'server-only'

import type {
  SkillsData,
  WorkspaceSkill,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/skills-session/model'
import type { Scenario } from '@/platform/fixtures'

const members: SkillsData['members'] = [
  { id: 'emir', name: 'Emir Karabeg', email: 'emir@example.com' },
  { id: 'alex', name: 'Alex Chen', email: 'alex@example.com', admin: true },
  { id: 'sam', name: 'Sam Rivera', email: 'sam@example.com' },
  { id: 'jules', name: 'Jules Martin', email: 'jules@example.com' },
]

const skills: WorkspaceSkill[] = [
  {
    id: 'weekly-review',
    name: 'weekly-review',
    description: 'Prepare the weekly operations review from completed work and open issues.',
    content:
      '# Weekly review\n\nSummarize the work completed this week. Group open issues by owner and close with the decisions the team needs to make.',
    access: 'editor',
    editorIds: ['alex', 'emir'],
  },
  {
    id: 'handoff',
    name: 'customer-handoff',
    description: 'Turn account notes into a handoff for the next owner.',
    content:
      '# Customer handoff\n\nIdentify the current owner, the customer’s goals and any open commitments. List the next steps with owners and dates.',
    access: 'viewer',
    editorIds: ['alex', 'sam'],
  },
  {
    id: 'builtin-deploy-workflow',
    name: 'deploy-workflow',
    description: 'Prepare a finished workflow for deployment.',
    content:
      '# Deploy workflow\n\nCheck that the workflow runs end to end. Choose how it should be published and confirm the deployed version.',
    access: 'built-in',
    editorIds: [],
  },
]

export function workspaceSkillsData(scenario: Scenario): SkillsData {
  const additional =
    scenario === 'stress'
      ? Array.from({ length: 28 }, (_, index) => ({
          ...skills[0],
          id: `review-${index}`,
          name: `international-onboarding-review-${index + 1}`,
          description:
            'Prepare a cross-functional customer onboarding review with the regional operations team.',
        }))
      : []
  return {
    skills: scenario === 'empty' ? [] : [...skills, ...additional],
    members,
    viewerId: 'emir',
    canCreate: true,
  }
}
