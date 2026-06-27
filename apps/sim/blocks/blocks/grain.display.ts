import { GrainIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GrainBlockDisplay = {
  type: 'grain',
  name: 'Grain',
  description: 'Access meeting recordings, transcripts, and AI summaries',
  category: 'tools',
  bgColor: '#F6FAF9',
  icon: GrainIcon,
  longDescription:
    'Integrate Grain into your workflow. Access meeting recordings, transcripts, highlights, and AI-generated summaries. Can also trigger workflows based on Grain webhook events.',
  docsLink: 'https://docs.sim.ai/integrations/grain',
  integrationType: IntegrationType.Productivity,
  triggerAllowed: true,
} satisfies BlockDisplay

export const GrainBlockMeta = {
  tags: ['meeting', 'note-taking'],
  url: 'https://grain.com',
  templates: [
    {
      icon: GrainIcon,
      title: 'Grain highlight to CRM',
      prompt:
        'Build a workflow that watches Grain meeting highlights, extracts customer quotes, and writes them to the linked Salesforce opportunity for deal context.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GrainIcon,
      title: 'Grain customer-quote miner',
      prompt:
        'Create a workflow that processes Grain customer interview recordings, extracts notable quotes and themes, and writes them to a marketing research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: GrainIcon,
      title: 'Grain action-item ticket creator',
      prompt:
        'Build a workflow that extracts action items from Grain meeting transcripts, creates Linear tasks for each with owners and due dates, and pings the team in Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: GrainIcon,
      title: 'Grain weekly call digest',
      prompt:
        'Create a scheduled weekly workflow that summarizes Grain meeting insights — common objections, decisions made, blockers — and posts a digest to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GrainIcon,
      title: 'Grain coaching dashboard',
      prompt:
        'Build a scheduled weekly workflow that analyzes Grain sales calls per rep, calculates talk ratio, objection handling, and next-step clarity, and writes coaching notes to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
    },
    {
      icon: GrainIcon,
      title: 'Grain + Notion knowledge sync',
      prompt:
        'Create a workflow that processes Grain meeting recordings, extracts decisions and learnings, and writes them as Notion pages tagged by topic for the team knowledge base.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: GrainIcon,
      title: 'Grain competitor mentions tracker',
      prompt:
        'Build a scheduled workflow that scans Grain sales transcripts for competitor mentions, logs the context and outcome to a competitive-intel table, and posts a weekly pattern summary to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'summarize-recent-calls',
      description:
        'Pull recent Grain recordings and produce a digest of key takeaways and action items per call.',
      content:
        '# Summarize Recent Calls\n\nTurn recent meeting recordings into a readable digest.\n\n## Steps\n1. List recordings, optionally filtered by a before/after datetime window, and paginate with the cursor if needed.\n2. For each recording, get the recording details and the transcript.\n3. From each transcript, extract the main topic, key takeaways, decisions, and action items with owners.\n4. Keep the per-call summary concise and consistent in structure.\n\n## Output\nReturn a digest with one section per call: title, date, participants, takeaways, and action items. Suitable for a daily or weekly recap.',
    },
    {
      name: 'extract-deal-signals',
      description:
        'Scan Grain sales-call transcripts for buying signals, objections, and competitor mentions.',
      content:
        '# Extract Deal Signals\n\nMine sales transcripts for signals that move a deal forward.\n\n## Steps\n1. List recordings for the target time window, or filter by a view that holds sales calls.\n2. Get the transcript for each recording.\n3. Classify mentions into buying signals, objections/risks, competitor mentions, and next steps, capturing the verbatim quote and context.\n4. Apply a framework (e.g. MEDDIC or SPICED) if one is specified to tag each insight.\n\n## Output\nReturn a structured list of signals grouped by category, each with the quote, the call it came from, and a suggested follow-up. Useful for CRM notes or a deal review.',
    },
    {
      name: 'pull-transcript',
      description: 'Retrieve a specific Grain recording and its full transcript by ID.',
      content:
        '# Pull Transcript\n\nFetch a single recording and its transcript for downstream use.\n\n## Steps\n1. If only a title or date is known, list recordings and match to find the recording ID.\n2. Get the recording details for metadata (title, participants, duration, date).\n3. Get the transcript for the recording.\n4. Clean the transcript into readable speaker-labeled turns.\n\n## Output\nReturn the recording metadata plus the formatted transcript. This is the building block for summaries, follow-up emails, or knowledge base ingestion.',
    },
  ],
} as const satisfies BlockMeta
