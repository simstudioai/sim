import { ClipboardList, Table } from '@sim/emcn/icons'
import { CirclebackIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const CirclebackBlock: BlockConfig = {
  type: 'circleback',
  name: 'Circleback',
  description: 'AI-powered meeting notes and action items',
  longDescription:
    'Receive meeting notes, action items, transcripts, and recordings when meetings are processed. Circleback uses webhooks to push data to your workflows.',
  category: 'triggers',
  integrationType: IntegrationType.AI,
  bgColor: 'linear-gradient(180deg, #E0F7FA 0%, #FFFFFF 100%)',
  docsLink: 'https://docs.sim.ai/integrations/circleback',
  icon: CirclebackIcon,
  triggerAllowed: true,

  subBlocks: [
    ...getTrigger('circleback_meeting_completed').subBlocks,
    ...getTrigger('circleback_meeting_notes').subBlocks,
    ...getTrigger('circleback_webhook').subBlocks,
  ],

  tools: {
    access: [],
  },

  inputs: {},

  outputs: {
    id: { type: 'number', description: 'Circleback meeting ID' },
    name: { type: 'string', description: 'Meeting title' },
    url: { type: 'string', description: 'Virtual meeting URL (Zoom, Meet, Teams)' },
    createdAt: { type: 'string', description: 'Meeting creation timestamp' },
    duration: { type: 'number', description: 'Duration in seconds' },
    recordingUrl: { type: 'string', description: 'Recording URL (valid 24 hours)' },
    tags: { type: 'json', description: 'Array of tags' },
    icalUid: { type: 'string', description: 'Calendar event ID' },
    attendees: { type: 'json', description: 'Array of attendee objects' },
    notes: { type: 'string', description: 'Meeting notes in Markdown' },
    actionItems: { type: 'json', description: 'Array of action items' },
    transcript: { type: 'json', description: 'Array of transcript segments' },
    insights: { type: 'json', description: 'User-created insights' },
    meeting: { type: 'json', description: 'Full meeting payload' },
  },

  triggers: {
    enabled: true,
    available: ['circleback_meeting_completed', 'circleback_meeting_notes', 'circleback_webhook'],
  },
}

export const CirclebackBlockMeta = {
  tags: ['meeting', 'note-taking'],
  url: 'https://circleback.ai',
  templates: [
    {
      icon: CirclebackIcon,
      title: 'Circleback recap to Slack',
      prompt:
        'Build a workflow that triggers when a meeting is processed in Circleback, takes the notes and action items from the payload, and posts a clean recap to the relevant Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClipboardList,
      title: 'Circleback action-item tracker',
      prompt:
        'Create a workflow that triggers when a Circleback meeting is processed, reads the action items from the payload, and writes each one to a tasks table with the owner and due date.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'automation'],
    },
    {
      icon: Table,
      title: 'Circleback notes to Notion',
      prompt:
        'Build a workflow that triggers when a meeting is processed in Circleback, pulls the notes, attendees, and transcript from the payload, and writes a structured meeting note to Notion with next steps.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'note-taking'],
      alsoIntegrations: ['notion'],
    },
  ],
} as const satisfies BlockMeta
