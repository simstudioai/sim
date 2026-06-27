import { LemlistIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const LemlistBlockDisplay = {
  type: 'lemlist',
  name: 'Lemlist',
  description: 'Manage outreach activities, leads, and send emails via Lemlist',
  category: 'tools',
  bgColor: '#316BFF',
  icon: LemlistIcon,
  longDescription:
    'Integrate Lemlist into your workflow. Retrieve campaign activities and replies, get lead information, and send emails through the Lemlist inbox.',
  docsLink: 'https://docs.sim.ai/integrations/lemlist',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const LemlistBlockMeta = {
  tags: ['sales-engagement', 'email-marketing', 'automation'],
  url: 'https://www.lemlist.com',
  templates: [
    {
      icon: LemlistIcon,
      title: 'Lemlist reply router',
      prompt:
        'Create a workflow triggered by Lemlist reply webhooks that classifies each reply by intent and posts a Slack notification to the lead owner with a one-line summary, the intent, and the reply text.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LemlistIcon,
      title: 'Lemlist campaign analyzer',
      prompt:
        'Build a scheduled workflow that pulls Lemlist campaign activities, computes open, click, reply, and bounce rates per campaign and per step, and writes the results to a tracking table so I can spot the steps that need rewriting.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis', 'reporting'],
    },
    {
      icon: LemlistIcon,
      title: 'Lemlist + Apollo prospect feeder',
      prompt:
        'Create a workflow that runs an Apollo search for an ICP, enriches each prospect with role and company signals, and sends a personalized first-touch email through Lemlist with a custom opening line per prospect.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: LemlistIcon,
      title: 'Lemlist interested-lead booker',
      prompt:
        'Build a workflow triggered when a Lemlist lead is marked interested that drafts a Calendly link tailored to the lead, replies to them through Lemlist with the link, and creates a follow-up task for the rep.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication', 'automation'],
      alsoIntegrations: ['calendly'],
    },
    {
      icon: LemlistIcon,
      title: 'Lemlist activity dashboard',
      prompt:
        'Create a scheduled daily workflow that pulls Lemlist activity for the last 24 hours, summarizes opens, clicks, replies, and step performance per campaign, and writes a per-rep dashboard to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'analysis'],
    },
    {
      icon: LemlistIcon,
      title: 'Lemlist bounced lead sweeper',
      prompt:
        'Build a workflow triggered by Lemlist email-bounced events that looks up the lead, writes the bounce to a suppression table, and posts a Slack alert so the team can clean the list and keep quality high.',
      alsoIntegrations: ['slack'],
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'analysis'],
    },
    {
      icon: LemlistIcon,
      title: 'Lemlist to HubSpot logger',
      prompt:
        'Create a workflow that watches Lemlist activity and logs every send, open, click, and reply to the matching HubSpot contact as an engagement, and creates a HubSpot task for the rep on positive replies.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'sync'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'triage-campaign-replies',
      description:
        'Pull recent Lemlist reply activity, classify each reply by intent, and surface the ones that need a human.',
      content:
        '# Triage Campaign Replies\n\nMonitor Lemlist replies and route them by intent so reps act on hot leads fast.\n\n## Steps\n1. Get Activities filtered to the Email Replied type, optionally scoped to a campaign ID, with a sensible limit.\n2. For each reply, look up the lead with Get Lead to attach name, company, and job title.\n3. Classify the reply intent: interested, not interested, out-of-office, unsubscribe, or question.\n4. For interested or question replies, build a short summary with the lead name, campaign, and the reply text.\n\n## Output\nA list of replies grouped by intent. For each interested or question reply, include lead name, company, campaign, a one-line summary, and the raw reply text so a rep can respond.',
    },
    {
      name: 'analyze-campaign-performance',
      description:
        'Compute open, click, reply, and bounce rates per campaign and per step from Lemlist activities and flag weak steps.',
      content:
        '# Analyze Campaign Performance\n\nTurn raw Lemlist activity into step-level metrics and concrete fixes.\n\n## Steps\n1. Get Activities for the target campaign with a high limit, paging with offset until all activity is collected.\n2. Tally events by type: emails sent, opened, clicked, replied, and bounced.\n3. Compute open rate, click rate, reply rate, and bounce rate overall and per sequence step.\n4. Flag steps where reply rate is low, bounce rate is high, or drop-off between steps is steep.\n\n## Output\nA per-campaign and per-step metrics table plus a short list of recommendations, such as rewriting a low-reply subject line or pausing a high-bounce step.',
    },
    {
      name: 'qualify-and-reply-to-lead',
      description:
        'Look up a Lemlist lead and send a personalized reply through their Lemlist mailbox.',
      content:
        '# Qualify and Reply to Lead\n\nRespond to an inbound lead with a tailored message sent from your Lemlist inbox.\n\n## Steps\n1. Get Lead by email or lead ID to pull first name, company, and job title.\n2. Draft a concise, personalized reply that references the lead context and includes a clear next step or booking link.\n3. Send Email through Lemlist using the sender user ID, sender email, mailbox ID, contact ID, lead ID, subject, and the drafted HTML message body.\n\n## Output\nConfirmation that the email was sent, the lead identity it went to, and the message body that was used.',
    },
  ],
} as const satisfies BlockMeta
