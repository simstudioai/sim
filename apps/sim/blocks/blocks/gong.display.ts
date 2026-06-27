import { GongIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GongBlockDisplay = {
  type: 'gong',
  name: 'Gong',
  description: 'Revenue intelligence and conversation analytics',
  category: 'tools',
  bgColor: '#8039DF',
  icon: GongIcon,
  iconColor: '#8039DF',
  longDescription:
    'Integrate Gong into your workflow. Access call recordings, transcripts, user data, activity stats, scorecards, trackers, library content, coaching metrics, and more via the Gong API.',
  docsLink: 'https://docs.sim.ai/integrations/gong',
  integrationType: IntegrationType.Sales,
  triggerAllowed: true,
} satisfies BlockDisplay

export const GongBlockMeta = {
  tags: ['meeting', 'sales-engagement', 'speech-to-text'],
  url: 'https://www.gong.io',
  templates: [
    {
      icon: GongIcon,
      title: 'Sales call analyzer',
      prompt:
        'Build a workflow that pulls call transcripts from Gong after each sales call, identifies key objections raised, action items promised, and competitor mentions, updates the deal record in my CRM, and posts a call summary with next steps to the Slack deal channel.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GongIcon,
      title: 'Gong objection tracker',
      prompt:
        'Build a scheduled weekly workflow that scans Gong sales calls for recurring objections, scores frequency and stage, and writes a competitive-intel digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GongIcon,
      title: 'Gong deal-risk surfacer',
      prompt:
        'Create a workflow that monitors Gong conversation intelligence signals, identifies deals at risk based on talk patterns, and posts a Slack alert to the AE and manager.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GongIcon,
      title: 'Gong coaching dashboard',
      prompt:
        'Build a scheduled weekly workflow that pulls Gong per-rep metrics — talk ratio, longest monologue, question rate — and writes a coaching table for managers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
    },
    {
      icon: GongIcon,
      title: 'Gong customer-quote miner',
      prompt:
        'Create a workflow that processes Gong customer interview calls, extracts notable quotes and themes, and writes them to a marketing research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: GongIcon,
      title: 'Gong CRM auto-updater',
      prompt:
        'Build a workflow that runs after a Gong sales call, summarizes objections and next steps, and updates the linked Salesforce or HubSpot opportunity with notes.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce', 'hubspot'],
    },
    {
      icon: GongIcon,
      title: 'Gong competitor-mention tracker',
      prompt:
        'Create a workflow that scans Gong calls for competitor mentions, captures context and outcome, and writes the competitive intel to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
  ],
  skills: [
    {
      name: 'summarize-call',
      description:
        'Pull a Gong call transcript and produce a structured recap with topics, objections, and next steps.',
      content:
        '# Summarize Call\n\nUse Gong to turn a recorded call into a clean recap.\n\n## Steps\n1. Get the call by its call ID to read the metadata (participants, duration, account).\n2. Get the call transcript for the same call ID.\n3. Identify the main topics, customer objections, and agreed next steps from the transcript.\n\n## Output\nReturn a recap: a short overview, key topics discussed, objections raised, and a list of next steps with owners. Keep it grounded in the transcript.',
    },
    {
      name: 'extract-deal-signals',
      description:
        'Read a Gong call transcript and extract CRM-ready deal signals like decision-maker, competitor, and next step.',
      content:
        '# Extract Deal Signals\n\nUse Gong to turn conversation content into structured deal attributes.\n\n## Steps\n1. Get the call transcript for the given call ID.\n2. Scan for high-value signals: decision-maker, budget, timeline, competitor mentions, use case, and the agreed next step with its date.\n3. Normalize each signal into a structured field.\n\n## Output\nReturn a structured object of deal attributes (decision_maker, competitor, next_step, next_step_date, use_case, and any others found). Leave fields null when not mentioned rather than guessing, so they can be written to CRM.',
    },
    {
      name: 'review-recent-calls',
      description:
        'List recent Gong calls in a date range and produce a digest of themes and follow-ups across them.',
      content:
        '# Review Recent Calls\n\nUse Gong to summarize a batch of recent calls.\n\n## Steps\n1. List calls (or use Get Extensive Calls) filtered by a date range and optionally by user or workspace.\n2. For the most relevant calls, get the transcript to pull themes and outcomes.\n3. Roll the findings up into recurring themes, common objections, and open follow-ups across the calls.\n\n## Output\nReturn a digest: a per-call one-liner, the cross-call themes, and a consolidated follow-up list. Note any call missing a clear next step.',
    },
  ],
} as const satisfies BlockMeta
