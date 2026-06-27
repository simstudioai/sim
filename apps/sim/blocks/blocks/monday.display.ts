import { MondayIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MondayBlockDisplay = {
  type: 'monday',
  name: 'Monday',
  description: 'Manage Monday.com boards, items, and groups',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MondayIcon,
  longDescription:
    'Integrate with Monday.com to list boards, get board details, fetch and search items, create and update items, archive or delete items, create subitems, move items between groups, add updates, and create groups.',
  docsLink: 'https://docs.sim.ai/integrations/monday',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const MondayBlockMeta = {
  tags: ['project-management', 'ticketing'],
  url: 'https://monday.com',
  templates: [
    {
      icon: MondayIcon,
      title: 'Monday status digest',
      prompt:
        'Create a scheduled weekly workflow that pulls Monday board progress, computes completion rate, and posts a status update to leadership Slack with the at-risk items highlighted.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MondayIcon,
      title: 'Monday board automator',
      prompt:
        'Build a workflow that watches Monday boards for status changes, applies branching automations — assign owners, set due dates, post Slack updates — based on a rules table.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MondayIcon,
      title: 'Monday client portal',
      prompt:
        'Create a workflow that mirrors a Monday project board into a client-facing summary table, refreshes hourly, and emails the client a snapshot link each week.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: MondayIcon,
      title: 'Monday SLA enforcer',
      prompt:
        'Build a workflow that watches Monday items with due dates, sends reminders 24 hours before, and escalates to managers when items breach SLA.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
    },
    {
      icon: MondayIcon,
      title: 'Monday + CRM sync',
      prompt:
        'Create a workflow that mirrors Monday CRM board items into Salesforce as opportunities, keeps stage and amount synced, and writes the Salesforce ID back to the Monday item.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'sync'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: MondayIcon,
      title: 'Monday workspace audit',
      prompt:
        'Build a scheduled monthly workflow that audits Monday boards for unused columns, stale automations, and missing owners, and writes a cleanup plan to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: MondayIcon,
      title: 'Monday onboarding kickoff',
      prompt:
        'Create a workflow that on a new hire in Workday creates a personalized Monday onboarding board, seeds the role-specific tasks, and invites the new hire and buddy.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
  ],
  skills: [
    {
      name: 'create-board-item',
      description: 'Create a new item on a Monday board in the right group with column values set.',
      content:
        '# Create Board Item\n\nAdd an item to a Monday.com board and populate its columns.\n\n## Steps\n1. Use List Boards to find the board, then Get Board to read its groups and column ids.\n2. Run Create Item with the board id, item name, and the target group.\n3. Map the requested fields to the correct column ids, formatting status and date columns as Monday expects.\n4. Add a follow-up Create Update if a comment or context note is needed on the item.\n\n## Output\nConfirm the new item id, board, and group. List the column values that were set.',
    },
    {
      name: 'find-items-by-criteria',
      description: 'Search a Monday board for items matching a value such as status or owner.',
      content:
        '# Find Items by Criteria\n\nLocate Monday.com items that match a given condition.\n\n## Steps\n1. Identify the board and the column to filter on with Get Board.\n2. Use Search Items or Get Items to retrieve candidates.\n3. Filter to the items whose column value matches the requested criteria.\n\n## Output\nA list of matching items with name, group, and the relevant column values. Note the total match count.',
    },
    {
      name: 'progress-item-status',
      description: 'Move a Monday item forward by updating its status column and group.',
      content:
        '# Progress Item Status\n\nAdvance a Monday.com item through its workflow.\n\n## Steps\n1. Get the item with Get Item to read its current status and group.\n2. Run Update Item to set the new status column value.\n3. If the stage maps to a different group, use Move Item to Group to keep the board organized.\n4. Optionally post a Create Update noting the transition.\n\n## Output\nConfirm the item id, the old and new status, and the group it now sits in.',
    },
  ],
} as const satisfies BlockMeta
