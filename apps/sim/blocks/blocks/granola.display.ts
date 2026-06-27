import { GranolaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GranolaBlockDisplay = {
  type: 'granola',
  name: 'Granola',
  description: 'Access meeting notes and transcripts from Granola',
  category: 'tools',
  bgColor: '#B2C147',
  icon: GranolaIcon,
  longDescription:
    'Integrate Granola into your workflow to retrieve meeting notes, summaries, attendees, and transcripts.',
  docsLink: 'https://docs.sim.ai/integrations/granola',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const GranolaBlockMeta = {
  tags: ['meeting', 'note-taking'],
  url: 'https://granola.ai',
  templates: [
    {
      icon: GranolaIcon,
      title: 'Granola meeting brief',
      prompt:
        'Build a scheduled workflow that reads upcoming meetings from Granola notes, researches attendees and topic with Apollo, and posts a prep brief to Slack before each meeting.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo', 'slack'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola action-item ticket creator',
      prompt:
        'Create a workflow that extracts action items from Granola meeting notes, creates Linear or Asana tasks for each with owners and due dates, and posts a summary to Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['linear', 'asana'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola CRM updater',
      prompt:
        'Build a workflow that runs after a Granola sales meeting, summarizes the meeting notes into a deal-ready summary, and updates the linked Salesforce or HubSpot opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce', 'hubspot'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola weekly digest',
      prompt:
        'Create a scheduled weekly workflow that aggregates Granola meeting notes, identifies recurring themes and decisions, and writes a digest to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola + Notion publisher',
      prompt:
        'Build a scheduled workflow that polls Granola for new meeting notes, generates a polished meeting-notes page in Notion under the right team space, and links the original Granola note.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola customer-interview extractor',
      prompt:
        'Create a workflow that processes Granola customer-interview notes, extracts notable quotes and pain points, and writes them to a tables-based research log.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola decision-log keeper',
      prompt:
        'Build a workflow that scans Granola meeting notes for decisions made, writes each to a tables-based decision log with date, owner, and context, and shares the link.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'digest-meeting-notes',
      description:
        'List recent Granola notes and produce a structured digest of takeaways and action items.',
      content:
        '# Digest Meeting Notes\n\nTurn recent Granola meeting notes into a concise digest.\n\n## Steps\n1. List notes, optionally limited to a recent time window.\n2. For each note, get the full note content.\n3. Extract the meeting title, key decisions, takeaways, and action items with owners and due dates if present.\n4. Keep each meeting summary short and uniformly structured.\n\n## Output\nReturn a digest with one section per meeting: title, date, decisions, takeaways, and action items. Suitable for a team recap or daily summary.',
    },
    {
      name: 'extract-action-items',
      description: 'Read a Granola note and pull out a clean list of action items with owners.',
      content:
        '# Extract Action Items\n\nIsolate the follow-ups from a single meeting note.\n\n## Steps\n1. If only a title or date is known, list notes and match to find the note ID.\n2. Get the note content.\n3. Identify every action item, normalizing each into a clear task with an owner and due date when stated.\n4. Drop duplicates and merge near-identical items.\n\n## Output\nReturn a list of action items, each with the task, owner, and due date. Ready to push into a task manager or tracking table.',
    },
    {
      name: 'log-decisions',
      description:
        'Scan Granola notes for decisions made and compile them into a dated decision log.',
      content:
        '# Log Decisions\n\nBuild an auditable record of decisions captured in meetings.\n\n## Steps\n1. List notes across the target window.\n2. Get each note and identify explicit decisions, the rationale, and who made them.\n3. Normalize each into a row with date, decision, owner, and context.\n\n## Output\nReturn a chronological decision log, each entry with date, decision, owner, and supporting context. Useful for writing to a decision-tracking table.',
    },
  ],
} as const satisfies BlockMeta
