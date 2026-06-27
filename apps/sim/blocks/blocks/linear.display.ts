import { DevinIcon, LinearIcon, SlackIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const LinearBlockDisplay = {
  type: 'linear',
  name: 'Linear (Legacy)',
  description: 'Interact with Linear issues, projects, and more',
  category: 'tools',
  bgColor: '#5E6AD2',
  icon: LinearIcon,
  longDescription:
    'Integrate Linear into the workflow. Can manage issues, comments, projects, labels, workflow states, cycles, attachments, and more. Can also trigger workflows based on Linear webhook events.',
  docsLink: 'https://docs.sim.ai/integrations/linear',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay

export const LinearV2BlockDisplay = {
  ...LinearBlockDisplay,
  type: 'linear_v2',
  name: 'Linear',
  hideFromToolbar: false,
} satisfies BlockDisplay

export const LinearBlockMeta = {
  tags: ['project-management', 'ticketing'],
  url: 'https://linear.app',
  templates: [
    {
      icon: LinearIcon,
      title: 'Linear knowledge search',
      prompt:
        'Create a knowledge base connected to my Linear workspace so all issues, comments, project updates, and decisions are automatically synced and searchable. Then build an agent I can ask things like "why did we deprioritize the mobile app?" or "what was the root cause of the checkout bug?" and get answers traced back to specific issues.',
      modules: ['knowledge-base', 'agent'],
      category: 'engineering',
      tags: ['engineering', 'research', 'product'],
    },
    {
      icon: DevinIcon,
      title: 'Linear ticket to Devin pipeline',
      prompt:
        'Create a workflow that fires when a Linear ticket gets the "devin" label, transforms the ticket description, acceptance criteria, and linked context into a Devin prompt, creates a session, and posts the session link plus an estimated completion window back on the ticket.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['devin'],
    },
    {
      icon: SlackIcon,
      title: 'Meeting notes to action items',
      prompt:
        'Create a workflow that takes meeting notes or a transcript, extracts action items with owners and due dates, creates tasks in Linear or Asana for each one, and posts a summary to the relevant Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['asana', 'slack'],
    },

    {
      icon: LinearIcon,
      title: 'Linear issue updates in Slack',
      prompt:
        'Build a workflow that monitors Linear for new issues, assignments, and completions, and posts a formatted Slack message for each event so your team is always in the loop.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['slack'],
    },
    {
      icon: LinearIcon,
      title: 'Bug report to Linear issue',
      prompt:
        'Build a workflow that watches a Slack channel for bug reports, extracts the steps to reproduce and severity with an agent, creates a labeled Linear issue in the right team, and replies in-thread with the issue link.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LinearIcon,
      title: 'Linear triage labeler',
      prompt:
        'Create a workflow that on a newly created Linear issue reads the title and description, adds the right labels for type and priority, assigns it to the correct team based on the area, and comments a triage summary.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation', 'project-management'],
    },
    {
      icon: LinearIcon,
      title: 'Linear sprint review digest',
      prompt:
        'Build a scheduled weekly workflow that searches Linear for issues completed and still open in the active cycle, summarizes progress and blockers with an agent, logs velocity to a table, and posts a sprint review digest to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'reporting', 'project-management'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'create-triaged-issue',
      description:
        'Create a Linear issue in the right team with a clear title, description, priority, and labels.',
      content:
        '# Create Triaged Issue\n\nTurn a request or bug report into a well-formed Linear issue.\n\n## Steps\n1. If the team is unknown, List Teams and pick the team that owns the area.\n2. Write a concise title and a description with context, steps to reproduce, and acceptance criteria.\n3. Create Issue with the team ID, title, description, and a priority that matches severity.\n4. Optionally Add Label to Issue for type and area labels using IDs from List Labels.\n\n## Output\nThe created issue ID, its identifier and URL, and the team, priority, and labels applied.',
    },
    {
      name: 'triage-new-issue',
      description:
        'Read a Linear issue, apply type and priority labels, set assignee and state, and comment a triage summary.',
      content:
        '# Triage New Issue\n\nTriage an incoming Linear issue so it lands in the right place with the right metadata.\n\n## Steps\n1. Get Issue to read the title and description.\n2. Determine the issue type, priority, and owning area from the content.\n3. Add Label to Issue for type and priority, and Update Issue to set the assignee, state, and priority.\n4. Create Comment with a short triage summary explaining the classification and next step.\n\n## Output\nThe issue identifier, the labels added, the assignee and state set, and the triage comment posted.',
    },
    {
      name: 'summarize-active-cycle',
      description:
        'Pull completed and open issues in the active cycle and produce a sprint progress digest.',
      content:
        '# Summarize Active Cycle\n\nProduce a sprint review digest from the current Linear cycle.\n\n## Steps\n1. Get Active Cycle for the team to find the current cycle.\n2. Read Issues or Search Issues scoped to that cycle, separating completed from still-open issues.\n3. Compute counts, completion percentage, and call out blocked or at-risk issues by priority.\n4. Summarize progress, blockers, and what is likely to slip.\n\n## Output\nA digest with completed vs open counts, completion percentage, a list of blockers, and a short narrative of cycle health.',
    },
    {
      name: 'post-project-update',
      description:
        'Assess a Linear project and post a project update with a health status and progress summary.',
      content:
        '# Post Project Update\n\nWrite a stakeholder-ready project update in Linear.\n\n## Steps\n1. Get Project to read its current state, target date, and lead.\n2. Read Issues for the project to gauge progress against the milestone or target date.\n3. Decide a health status of on track, at risk, or off track based on remaining work and timeline.\n4. Create Project Update with the chosen health and a concise body covering progress, risks, and next steps.\n\n## Output\nConfirmation of the posted update, the health status chosen, and the update body.',
    },
  ],
} as const satisfies BlockMeta
