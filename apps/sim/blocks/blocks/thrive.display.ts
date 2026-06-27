import { ThriveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ThriveBlockDisplay = {
  type: 'thrive',
  name: 'Thrive',
  description: 'Manage users, audiences, learning and CPD on Thrive',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ThriveIcon,
  longDescription:
    'Integrate Thrive Learning into the workflow. Manage user lifecycle, audiences and their members and managers, content assignments and enrolments, learning completions, content and activity records, CPD, tags, and skills.',
  docsLink: 'https://docs.sim.ai/tools/thrive',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay

export const ThriveBlockMeta = {
  tags: ['content-management', 'knowledge-base', 'automation'],
  url: 'https://thrivelearning.com',
  templates: [
    {
      icon: ThriveIcon,
      title: 'Onboard new hires into Thrive',
      prompt:
        'Build a workflow that, when a new employee row is added to a Google Sheet, creates the user in Thrive with their ref, name, email, job title, and manager, then adds them to the relevant onboarding audience.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'onboarding', 'automation'],
      alsoIntegrations: ['google_sheets'],
    },
    {
      icon: ThriveIcon,
      title: 'Compliance completion digest',
      prompt:
        'Create a scheduled weekly workflow that lists Thrive enrolments for a compliance assignment, filters those still open or overdue, and posts a Slack summary to the people-ops channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['compliance', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ThriveIcon,
      title: 'Sync leavers from HRIS',
      prompt:
        'Build a workflow that reads terminated employees from an HRIS export and suspends each matching user in Thrive with their end date, then logs the result to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'lifecycle', 'automation'],
    },
    {
      icon: ThriveIcon,
      title: 'Import historical completions',
      prompt:
        'Create a workflow that reads a CSV of prior learning records and creates a completion in Thrive for each user and content item with the completion date.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['migration', 'learning'],
    },
    {
      icon: ThriveIcon,
      title: 'Assign mandatory training to an audience',
      prompt:
        'Build a workflow that creates a Thrive content assignment for a chosen audience and primary content, sets a 30-day completion period, and reports how many learners were enrolled.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['compliance', 'learning'],
    },
    {
      icon: ThriveIcon,
      title: 'CPD shortfall report',
      prompt:
        'Create a scheduled monthly workflow that queries Thrive CPD user summaries for a date range, compares logged minutes against each audience CPD requirement, and emails managers a list of learners below target.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['cpd', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ThriveIcon,
      title: 'Tag learners by skill',
      prompt:
        'Build a workflow that searches Thrive users by status, then adds skill tags and updates skill levels for each learner based on a mapping in a spreadsheet.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['skills', 'automation'],
      alsoIntegrations: ['google_sheets'],
    },
    {
      icon: ThriveIcon,
      title: 'Trending content to Slack',
      prompt:
        'Create a scheduled workflow that queries recently updated Thrive content and activity records, summarises the most engaged-with learning, and posts a weekly highlight to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'engagement'],
      alsoIntegrations: ['slack'],
    },
  ],
} as const satisfies BlockMeta
