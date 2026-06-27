import { FirefliesIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const FirefliesBlockDisplay = {
  type: 'fireflies',
  name: 'Fireflies (Legacy)',
  description: 'Interact with Fireflies.ai meeting transcripts and recordings',
  category: 'tools',
  bgColor: '#100730',
  icon: FirefliesIcon,
  longDescription:
    'Integrate Fireflies.ai into the workflow. Manage meeting transcripts, add bot to live meetings, create soundbites, and more. Can also trigger workflows when transcriptions complete.',
  docsLink: 'https://docs.sim.ai/integrations/fireflies',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay

export const FirefliesV2BlockDisplay = {
  ...FirefliesBlockDisplay,
  type: 'fireflies_v2',
  name: 'Fireflies',
  description: 'Interact with Fireflies.ai meeting transcripts and recordings',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: false,
} satisfies BlockDisplay

export const FirefliesBlockMeta = {
  tags: ['meeting', 'note-taking'],
  url: 'https://fireflies.ai',
  templates: [
    {
      icon: FirefliesIcon,
      title: 'Fireflies meeting recap to Slack',
      prompt:
        'Build a workflow that runs when a Fireflies recording finishes, pulls the transcript, summarizes decisions and action items, and posts the recap to the linked Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: FirefliesIcon,
      title: 'Fireflies CRM updater',
      prompt:
        'Create a workflow that runs after a Fireflies sales call, summarizes objections and next steps, and updates the linked Salesforce or HubSpot opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce', 'hubspot'],
    },
    {
      icon: FirefliesIcon,
      title: 'Fireflies action-item ticket creator',
      prompt:
        'Build a workflow that extracts action items from a Fireflies meeting transcript, creates Linear or Asana tasks for each with owners and due dates, and posts a summary to Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['linear', 'asana'],
    },
    {
      icon: FirefliesIcon,
      title: 'Fireflies customer-quote miner',
      prompt:
        'Create a workflow that processes Fireflies transcripts for customer interview calls, extracts notable quotes and themes, and writes them to a marketing research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: FirefliesIcon,
      title: 'Fireflies talk-ratio coach',
      prompt:
        'Build a scheduled weekly workflow that pulls Fireflies sales-call analytics per rep — talk ratio, longest monologue, question rate — and posts a coaching digest to managers.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: FirefliesIcon,
      title: 'Fireflies + Notion meeting notes',
      prompt:
        'Create a workflow that watches Fireflies recordings, generates a polished meeting-notes page in Notion under the right team space, and links the recording.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: FirefliesIcon,
      title: 'Fireflies competitor-mention tracker',
      prompt:
        'Build a workflow that scans Fireflies sales transcripts for competitor mentions, logs the context and outcome to a competitive-intel table, and posts notable patterns to Slack weekly.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'summarize-meeting-transcript',
      description:
        'Fetch a Fireflies transcript and produce a structured recap with decisions, action items, and owners.',
      content:
        '# Summarize Meeting Transcript\n\nUse Fireflies to turn a recorded meeting into a clean recap.\n\n## Steps\n1. Get the transcript for the given transcript ID (or pick the latest from List Transcripts).\n2. Read the sentences and any provided summary to identify the main topics discussed.\n3. Extract key decisions, action items with owners, and notable questions or risks.\n\n## Output\nReturn a structured recap: a short overview, a bulleted list of decisions, and an action-item table (task, owner, due date). Keep it grounded in the transcript content.',
    },
    {
      name: 'extract-action-items',
      description:
        'Pull a Fireflies transcript and extract a clean list of action items with owners and due dates.',
      content:
        '# Extract Action Items\n\nUse Fireflies to capture follow-ups from a meeting.\n\n## Steps\n1. Get the transcript for the meeting by its transcript ID.\n2. Scan the sentences for commitments, assignments, and next steps.\n3. Attribute each item to the speaker who owns it and capture any stated deadline.\n\n## Output\nReturn a list of action items, each with the task, owner, and due date (or null). Add a one-line meeting summary at the top for context.',
    },
    {
      name: 'create-meeting-soundbite',
      description:
        'Create a Fireflies soundbite (bite) clipping a key moment from a transcript for sharing.',
      content:
        '# Create Meeting Soundbite\n\nUse Fireflies to clip and share a highlight from a recorded meeting.\n\n## Steps\n1. Get the transcript and find the start and end timestamps of the moment to clip.\n2. Use Create Bite with the transcript ID and the chosen time range.\n3. Confirm the bite was created and capture its identifier or link.\n\n## Output\nReturn the soundbite identifier or shareable link plus a short caption describing the clipped moment.',
    },
  ],
} as const satisfies BlockMeta

export const FirefliesV2BlockMeta = {
  tags: ['meeting', 'note-taking'],
  url: 'https://fireflies.ai',
} as const satisfies BlockMeta
