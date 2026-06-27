import { ClipboardList, Table } from '@/components/emcn/icons'
import { CirclebackIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CirclebackBlockDisplay = {
  type: 'circleback',
  name: 'Circleback',
  description: 'AI-powered meeting notes and action items',
  category: 'triggers',
  bgColor: 'linear-gradient(180deg, #E0F7FA 0%, #FFFFFF 100%)',
  icon: CirclebackIcon,
  longDescription:
    'Receive meeting notes, action items, transcripts, and recordings when meetings are processed. Circleback uses webhooks to push data to your workflows.',
  docsLink: 'https://docs.sim.ai/integrations/circleback',
  integrationType: IntegrationType.AI,
  triggerAllowed: true,
} satisfies BlockDisplay

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
