import { JiraIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const JiraBlockDisplay = {
  type: 'jira',
  name: 'Jira',
  description: 'Interact with Jira',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: JiraIcon,
  longDescription:
    'Integrate Jira into the workflow. Can read, write, and update issues. Can also trigger workflows based on Jira webhook events.',
  docsLink: 'https://docs.sim.ai/integrations/jira',
  integrationType: IntegrationType.Productivity,
  triggerAllowed: true,
} satisfies BlockDisplay

export const JiraBlockMeta = {
  tags: ['project-management', 'ticketing'],
  url: 'https://www.atlassian.com/software/jira',
  templates: [
    {
      icon: JiraIcon,
      title: 'Jira knowledge search',
      prompt:
        'Create a knowledge base connected to my Jira project so all tickets, comments, and resolutions are automatically synced and searchable. Then build an agent I can ask things like "how did we fix the auth timeout issue?" or "what was decided about the API redesign?" and get answers with ticket citations.',
      modules: ['knowledge-base', 'agent'],
      category: 'engineering',
      tags: ['engineering', 'research'],
    },
    {
      icon: JiraIcon,
      title: 'Sprint report generator',
      prompt:
        'Create a scheduled workflow that runs at the end of each sprint, pulls all completed, in-progress, and blocked Jira tickets, calculates velocity and carry-over, and generates a sprint summary document with charts and trends to share with the team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'reporting', 'team'],
    },
    {
      icon: JiraIcon,
      title: 'Jira backlog grooming digest',
      prompt:
        'Build a scheduled weekly workflow that scans Jira backlog for tickets missing estimates, owners, or priorities, generates a grooming queue, and posts the top items to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JiraIcon,
      title: 'Jira stale-ticket sweeper',
      prompt:
        'Create a scheduled workflow that lists Jira tickets with no activity in 14 days, pings the assignee in Slack with a status prompt, and updates the ticket based on the response.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JiraIcon,
      title: 'Jira release notes builder',
      prompt:
        'Build a workflow that pulls Jira tickets resolved since the last release tag, groups by feature area, and drafts user-facing release notes for marketing review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['engineering', 'content'],
    },
    {
      icon: JiraIcon,
      title: 'Jira to Linear migrator',
      prompt:
        'Create a workflow that imports a Jira project into Linear, preserving status mapping, labels, comments, and assignees, and writes a mapping table for redirect URLs.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['linear'],
    },

    {
      icon: JiraIcon,
      title: 'Auto-generate Confluence pages from Jira sprints',
      prompt:
        'Build a workflow that runs at the end of each Jira sprint, pulls all completed and in-progress tickets, and automatically creates a structured Confluence documentation page so sprint reporting requires no manual effort.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['confluence'],
    },
  ],
  skills: [
    {
      name: 'create-bug-from-report',
      description:
        'Turn a bug report into a well-structured Jira issue with steps, severity, and labels.',
      content:
        '# Create a Bug From a Report\n\nConvert a raw bug report into a clean, actionable Jira issue.\n\n## Steps\n1. Parse the report for summary, steps to reproduce, expected vs actual behavior, and environment.\n2. Create an issue in the target project with type Bug, a clear summary, and a structured description.\n3. Set priority based on impact and add relevant labels or components.\n4. Optionally assign it to the right owner.\n\n## Output\nReturn the issue key, URL, priority, and assignee. Confirm the description includes reproduction steps.',
    },
    {
      name: 'triage-open-issues',
      description: 'Search open issues with JQL and propose assignees, priorities, and labels.',
      content:
        '# Triage Open Issues\n\nBring order to a backlog of unassigned or stale issues.\n\n## Steps\n1. Search issues using JQL (e.g. unassigned and recently created in a project).\n2. Read each issue to understand scope and urgency.\n3. For each, propose a priority, suggested assignee, and labels; apply updates where confident.\n4. Add a short triage comment explaining the decision.\n\n## Output\nReturn a table of issues with proposed/applied priority, assignee, and labels, flagging any that need a human decision.',
    },
    {
      name: 'transition-and-comment',
      description: 'Move an issue to a new workflow status and post a progress comment.',
      content:
        '# Transition and Comment\n\nAdvance a Jira issue through its workflow with a clear note.\n\n## Steps\n1. Retrieve the issue and read its current status.\n2. Get available transitions and choose the correct next status (e.g. In Progress, In Review, Done).\n3. Transition the issue to that status.\n4. Add a comment summarizing what changed and any next steps.\n\n## Output\nReturn the issue key, the new status, and the comment that was posted.',
    },
    {
      name: 'sprint-status-digest',
      description: 'Summarize issues in a project or sprint grouped by status and assignee.',
      content:
        '# Sprint Status Digest\n\nProduce a quick read on where work stands.\n\n## Steps\n1. Search issues with JQL scoped to the project or current sprint.\n2. Group results by status and by assignee.\n3. Identify blocked issues, overdue items, and anything unassigned.\n\n## Output\nReturn a digest: counts by status, work per assignee, and a callout list of blocked or at-risk issues with their keys.',
    },
  ],
} as const satisfies BlockMeta
