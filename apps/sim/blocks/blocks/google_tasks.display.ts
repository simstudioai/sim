import { GoogleTasksIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleTasksBlockDisplay = {
  type: 'google_tasks',
  name: 'Google Tasks',
  description: 'Manage Google Tasks',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleTasksIcon,
  longDescription:
    'Integrate Google Tasks into your workflow. Create, read, update, delete, and list tasks and task lists.',
  docsLink: 'https://docs.sim.ai/integrations/google_tasks',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const GoogleTasksBlockMeta = {
  tags: ['google-workspace', 'project-management', 'scheduling'],
  url: 'https://workspace.google.com/products/tasks',
  templates: [
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks digest',
      prompt:
        'Build a scheduled daily workflow that summarizes Google Tasks due today and tomorrow, and emails the user a prioritized digest each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks from Gmail',
      prompt:
        'Create a workflow that watches Gmail for emails marked with a task label, extracts the action and due date, and creates a Google Tasks entry with a link back to the email.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks from meetings',
      prompt:
        'Build a workflow that runs after Google Meet meetings, extracts action items from the transcript, and creates Google Tasks entries for the owner with due dates.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['google_meet'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks completion digest',
      prompt:
        'Create a scheduled weekly workflow that summarizes Google Tasks completed by the user, captures the throughput, and emails a personal productivity report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks rolling cleanup',
      prompt:
        'Build a scheduled workflow that runs daily, archives Google Tasks completed more than 30 days ago, and surfaces tasks past their due date for re-prioritization.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks Slack sync',
      prompt:
        'Create a workflow that watches Slack for messages tagged with the saved-task emoji, captures the message and creates a Google Tasks entry with a link to the Slack thread.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'sync'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleTasksIcon,
      title: 'Google Tasks calendar block builder',
      prompt:
        'Build a workflow that on a Google Tasks creation also inserts a Google Calendar focus block with the task title, so the time is actually reserved.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['google_calendar'],
    },
  ],
  skills: [
    {
      name: 'capture-action-items',
      description:
        'Turn a list of action items into Google Tasks with titles, notes, and due dates in the right task list.',
      content:
        '# Capture Action Items\n\nConvert extracted action items into well-formed Google Tasks.\n\n## Steps\n1. List the available task lists and pick the target list (default to the primary list if none specified).\n2. For each action item, create a task with a concise title, detailed notes for context, and a due date if one was given.\n3. Avoid duplicates by skipping items whose title already exists in the list.\n\n## Output\nReturn the created task IDs and titles, grouped by task list. Note any items skipped as duplicates.',
    },
    {
      name: 'list-due-and-overdue',
      description:
        'List open Google Tasks that are due soon or overdue across a task list for a daily review.',
      content:
        '# List Due and Overdue Tasks\n\nSurface tasks that need attention for a daily or weekly review.\n\n## Steps\n1. List the task lists, or use a specified list.\n2. List tasks in the list, including completed status and due dates.\n3. Filter to incomplete tasks and split into Overdue (due before today) and Due Soon (due within the next few days).\n4. Sort each group by due date ascending.\n\n## Output\nReturn two sections, Overdue and Due Soon, each with task title, due date, and task ID. Useful for posting a standup or reminder digest.',
    },
    {
      name: 'complete-task-by-title',
      description: 'Find a Google Task by its title and mark it completed.',
      content:
        '# Complete Task By Title\n\nMark a task done when given a title rather than an ID.\n\n## Steps\n1. List tasks in the relevant task list and match the requested title (case-insensitive, allow partial match).\n2. If multiple match, prefer the incomplete one; if still ambiguous, return the candidates and ask for clarification.\n3. Update the matched task to set its status to completed.\n4. Confirm the update by reading the task back.\n\n## Output\nReturn the completed task title and ID, or the list of ambiguous candidates if no single match was found.',
    },
  ],
} as const satisfies BlockMeta
