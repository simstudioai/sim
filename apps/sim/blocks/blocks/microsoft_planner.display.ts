import { MicrosoftPlannerIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MicrosoftPlannerBlockDisplay = {
  type: 'microsoft_planner',
  name: 'Microsoft Planner',
  description: 'Manage tasks, plans, and buckets in Microsoft Planner',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftPlannerIcon,
  longDescription:
    'Integrate Microsoft Planner into the workflow. Manage tasks, plans, buckets, and task details including checklists and references.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_planner',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const MicrosoftPlannerBlockMeta = {
  tags: ['project-management', 'microsoft-365'],
  url: 'https://www.microsoft.com/microsoft-365/business/task-management-software',
  templates: [
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner sprint digest',
      prompt:
        'Create a scheduled weekly workflow that pulls Microsoft Planner bucket progress, computes completion rate per bucket, and posts a status digest to the project Microsoft Teams channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner SLA monitor',
      prompt:
        'Build a workflow that watches Microsoft Planner tasks with due dates, sends reminders 24 hours before, and escalates to managers in Teams when items breach SLA.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner Excel-import',
      prompt:
        'Create a workflow that takes a Microsoft Excel task list, creates matching Planner tasks in the right bucket, and writes the planner IDs back to the spreadsheet for tracking.',
      modules: ['files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'sync'],
      alsoIntegrations: ['microsoft_excel'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner blocker watcher',
      prompt:
        'Build a scheduled workflow that scans Microsoft Planner tasks tagged blocked, identifies the blocking party, and posts a Teams ping with the context to unblock the work.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner template launcher',
      prompt:
        'Create a scheduled workflow that polls Microsoft Dataverse for new projects and creates a Planner plan from the project template, populates the standard buckets, and assigns the right owners.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['microsoft_dataverse'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner retrospective',
      prompt:
        'Build a scheduled workflow that runs at the end of a sprint, pulls completed Microsoft Planner tasks, summarizes wins and patterns, and writes the retro doc to a SharePoint page.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftPlannerIcon,
      title: 'Microsoft Planner workload balancer',
      prompt:
        'Create a scheduled weekly workflow that audits Microsoft Planner assignment load per team member, suggests rebalancing, and posts the recommendations to the manager in Teams.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'analysis'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'create-task-in-bucket',
      description:
        'Create a Microsoft Planner task in a specific plan and bucket with title, due date, and assignee.',
      content:
        '# Create Planner Task\n\nCreate a new task in a Microsoft Planner plan, placing it in the right bucket and setting a due date and owner.\n\n## Steps\n1. Use List Plans to find the target plan, then List Buckets for that plan to locate the bucket id.\n2. Run Create Task with the plan id, a clear title, and the bucket id so it lands in the right column.\n3. If a due date was described in natural language, convert it to ISO 8601 (YYYY-MM-DDTHH:MM:SSZ) before passing dueDateTime.\n4. Set assigneeUserId when an owner is known.\n\n## Output\nConfirm the created task id and report title, bucket, due date, and assignee. Surface the etag for any follow-up updates.',
    },
    {
      name: 'set-up-plan-buckets',
      description:
        'Create a set of stage or phase buckets in a Planner plan to organize tasks by workflow column.',
      content:
        '# Set Up Plan Buckets\n\nStructure a Microsoft Planner plan into the workflow columns a team needs, such as To Do, In Progress, Review, and Done, or project phases.\n\n## Steps\n1. Use List Plans to find the target plan, then List Buckets to see which buckets already exist and avoid duplicates.\n2. Run Create Bucket once per desired column, passing the plan id and a clear bucket name.\n3. Keep names short and ordered so the board reads left to right as work progresses.\n\n## Output\nList every bucket id and name that now exists in the plan, marking which were newly created. Suggest the next bucket only if a stage is clearly missing.',
    },
    {
      name: 'add-task-checklist',
      description:
        'Add a step-by-step checklist to a Planner task so each subtask can be tracked and checked off.',
      content:
        '# Add Task Checklist\n\nBreak a Microsoft Planner task into trackable subtasks using its checklist.\n\n## Steps\n1. Identify the target task id, using Read Task to confirm the title if needed.\n2. Use Get Task Details to read the current checklist and capture the etag required for updates.\n3. Run Update Task Details with the checklist items to add, passing the etag from the previous step.\n4. Set percentComplete on the task with Update Task when progress should reflect the checklist state.\n\n## Output\nConfirm the task id and list the checklist items now present. Note the refreshed etag for any further edits.',
    },
  ],
} as const satisfies BlockMeta
