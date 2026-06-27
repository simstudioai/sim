import { AsanaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AsanaBlockDisplay = {
  type: 'asana',
  name: 'Asana',
  description: 'Interact with Asana',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: AsanaIcon,
  longDescription: 'Integrate Asana into the workflow. Can read, write, and update tasks.',
  docsLink: 'https://docs.sim.ai/integrations/asana',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const AsanaBlockMeta = {
  tags: ['project-management', 'ticketing', 'automation'],
  url: 'https://asana.com',
  templates: [
    {
      icon: AsanaIcon,
      title: 'Asana sprint planner',
      prompt:
        'Build a workflow that on Monday morning compiles uncompleted Asana tasks, rebalances against capacity, and posts the sprint plan to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana stuck-task surfacer',
      prompt:
        'Create a scheduled workflow that finds Asana tasks with no progress for 5+ days, pings the assignee in Slack with a quick-action prompt, and updates the task status based on their answer.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana cross-team blocker watcher',
      prompt:
        'Build a scheduled workflow that searches Asana for tasks tagged blocked, identifies the blocking team based on dependency metadata, and posts a request to the right channel in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana onboarding task launcher',
      prompt:
        'Create a workflow that on a new Salesforce opportunity creates a customer-onboarding Asana task with the right assignee and due date, and writes the task link back to the opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana weekly project digest',
      prompt:
        'Build a scheduled weekly workflow that summarizes Asana project progress — completed, in-progress, at-risk — and emails a status update to each project sponsor.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana retro generator',
      prompt:
        'Create a workflow that pulls Asana tasks completed in a sprint, summarizes wins, blockers, and patterns, and writes a retro doc shared with the team via Slack.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AsanaIcon,
      title: 'Asana bug intake triager',
      prompt:
        'Build a workflow that searches Asana for newly created tasks in the bug project, classifies each by severity and component with an agent, adds a triage comment, and creates a matching GitHub issue for engineering pickup.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['github'],
    },
  ],
  skills: [
    {
      name: 'create-task-from-request',
      description:
        'Turn an incoming request or message into a well-formed Asana task in the right project with assignee and due date. Use for intake and ticket creation.',
      content:
        '# Create Task from Request\n\nConvert an incoming request into a structured Asana task.\n\n## Steps\n1. Extract the work to be done, the relevant project, an assignee if named, and any due date.\n2. If the project is referenced by name, list projects to resolve its ID.\n3. Create the task with a clear name, a description capturing the request details, the project, assignee, and due date.\n4. Add a comment with any links or source context if helpful.\n\n## Output\nReport the created task name, its URL or ID, project, assignee, and due date.',
    },
    {
      name: 'summarize-project-tasks',
      description:
        'Search tasks in an Asana project and summarize status, overdue items, and who owns what. Use for standups and project status checks.',
      content:
        '# Summarize Project Tasks\n\nProduce a status snapshot of an Asana project.\n\n## Steps\n1. Resolve the project, then search its tasks.\n2. For each task capture name, assignee, due date, and completion state.\n3. Group into completed, in progress, and overdue or due soon.\n4. Note any unassigned tasks or tasks with no due date.\n\n## Output\nA concise status summary: counts per group, overdue tasks called out by name and owner, and any gaps to address.',
    },
    {
      name: 'update-task-status',
      description:
        'Find an Asana task and update its fields — assignee, due date, completion, or add a progress comment. Use to keep tasks current from other systems.',
      content:
        '# Update Task Status\n\nKeep an Asana task in sync with the latest state.\n\n## Steps\n1. Identify the target task by ID, or search to find it by name.\n2. Read the current task to confirm it is the right one.\n3. Update the relevant fields — completion, assignee, or due date.\n4. Add a comment summarizing what changed and why.\n\n## Output\nReport which fields changed and confirm the task ID. If no matching task was found, say so.',
    },
  ],
} as const satisfies BlockMeta
