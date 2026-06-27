import { BookOpen, ClipboardList, File, Table, Users } from '@/components/emcn/icons'
import { GoogleTranslateIcon, GreptileIcon, LinearIcon, SlackIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SlackBlockDisplay = {
  type: 'slack',
  name: 'Slack',
  description:
    'Send, update, delete messages, manage views and modals, add or remove reactions, manage canvases, get channel info and user presence in Slack',
  category: 'tools',
  bgColor: '#611f69',
  icon: SlackIcon,
  longDescription:
    'Integrate Slack into the workflow. Can send, update, and delete messages, send ephemeral messages visible only to a specific user, open/update/push modal views, publish Home tab views, create canvases, read messages, and add or remove reactions. Requires Bot Token instead of OAuth in advanced mode. Can be used in trigger mode to trigger a workflow when a message is sent to a channel.',
  docsLink: 'https://docs.sim.ai/integrations/slack',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay

export const SlackBlockMeta = {
  tags: ['messaging', 'webhooks', 'automation'],
  url: 'https://slack.com',
  templates: [
    {
      icon: SlackIcon,
      title: 'Slack Q&A bot',
      prompt:
        'Create a knowledge base connected to my Notion workspace so it stays synced with my company wiki. Then build a workflow that monitors Slack channels for questions and answers them using the knowledge base with source citations.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'team'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: Table,
      title: 'Churn risk detector',
      prompt:
        'Create a workflow that monitors customer activity — support ticket frequency, response sentiment, usage patterns — scores each account for churn risk in a table, and triggers a Slack alert to the account team when a customer crosses the risk threshold.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'sales', 'monitoring', 'analysis'],
    },
    {
      icon: LinearIcon,
      title: 'Incident postmortem writer',
      prompt:
        'Create a workflow that when triggered after an incident, pulls the Slack thread from the incident channel, gathers relevant Sentry errors and deployment logs, and drafts a structured postmortem with timeline, root cause, and action items.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'analysis'],
      alsoIntegrations: ['sentry'],
    },
    {
      icon: GreptileIcon,
      title: 'Slack code Q&A bot',
      prompt:
        'Build a workflow that monitors a Slack channel for code questions, routes them to Greptile against the relevant repository, and replies in-thread with the answer and the cited files so the team gets quick, sourced engineering answers.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'communication', 'team'],
      alsoIntegrations: ['greptile'],
    },
    {
      icon: SlackIcon,
      title: 'Slack knowledge search',
      prompt:
        'Create a knowledge base connected to my Slack workspace so all channel conversations and threads are automatically synced and searchable. Then build an agent I can ask things like "what did the team decide about the launch date?" or "what was the outcome of the design review?" and get answers with links to the original messages.',
      modules: ['knowledge-base', 'agent'],
      category: 'productivity',
      tags: ['team', 'research', 'communication'],
    },
    {
      icon: File,
      title: 'Automated narrative report',
      prompt:
        'Build a scheduled workflow that pulls key data from my tables every week, analyzes trends and anomalies, and writes a narrative report — not just charts and numbers, but written insights explaining what changed, why it matters, and what to do next. Save it as a document and send a summary to Slack.',
      modules: ['tables', 'scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['founder', 'reporting', 'analysis'],
    },
    {
      icon: BookOpen,
      title: 'Email digest curator',
      prompt:
        'Create a scheduled daily workflow that searches the web for the latest articles, papers, and news on topics I care about, picks the top 5 most relevant pieces, writes a one-paragraph summary for each, and delivers a curated reading digest to my inbox or Slack.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'content'],
    },
    {
      icon: ClipboardList,
      title: 'Daily standup summary',
      prompt:
        'Create a scheduled workflow that reads the #standup Slack channel each morning, summarizes what everyone is working on, identifies blockers, and posts a structured recap to a Google Docs document.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting', 'communication'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: Users,
      title: 'New hire onboarding automation',
      prompt:
        "Build a workflow that when triggered with a new hire's info, creates their accounts, sends a personalized welcome message in Slack, schedules 1:1s with their team on Google Calendar, shares relevant onboarding docs from the knowledge base, and tracks completion in a table.",
      modules: ['knowledge-base', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'team'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: Table,
      title: 'Customer 360 view',
      prompt:
        'Create a comprehensive customer table that aggregates data from my CRM, support tickets, billing history, and product usage into a single unified view per customer. Schedule it to sync daily and send a Slack alert when any customer shows signs of trouble across multiple signals.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['founder', 'sales', 'support', 'enterprise', 'sync'],
    },
    {
      icon: GoogleTranslateIcon,
      title: 'Slack thread translator',
      prompt:
        'Build a workflow that watches international Slack channels, detects non-English messages, translates them with Google Translate, and posts the English version in a thread so the wider team stays in the loop.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['google_translate'],
    },

    {
      icon: SlackIcon,
      title: 'Archive Slack conversations to Notion',
      prompt:
        'Build a workflow that captures important Slack messages and threads and saves them as Notion pages or database entries, so meeting notes and decisions are always documented.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'daily-standup-summary',
      description:
        'Read a standup channel and post a structured recap of progress, plans, and blockers.',
      content:
        '# Daily Standup Summary\n\nRead the messages posted in the standup channel since the last working day and produce a concise team recap.\n\n## Steps\n1. Collect every standup update in the channel from the relevant window (skip bot and off-topic messages).\n2. Group the content into three sections:\n   - **Done** — what was completed.\n   - **Today** — what each person plans to work on.\n   - **Blockers** — anything waiting on someone else, with the owner @-mentioned.\n3. Call out anyone who did not post an update.\n\n## Output\nPost a single threaded message with the three sections as bullet lists. Keep each bullet to one line. Lead with blockers if any exist so they are not missed.',
    },
    {
      name: 'channel-catch-up',
      description: 'Summarize what happened in a busy Slack channel so you can catch up fast.',
      content:
        '# Channel Catch-Up\n\nSummarize recent activity in a Slack channel for someone who has been away.\n\n## Steps\n1. Pull messages from the requested time range (default: since the user was last active, or the last 24 hours).\n2. Cluster the conversation into topics or threads rather than listing messages chronologically.\n3. For each topic, capture: the gist, any decision reached, and open questions still unanswered.\n\n## Output\n- A 1-sentence TL;DR.\n- A bulleted list of topics, each with **Decision:** and **Open:** lines where relevant.\n- A final "Needs your input" list of items where the user was @-mentioned or a question is unresolved.\nLink to the source thread for each topic.',
    },
    {
      name: 'slack-question-responder',
      description:
        'Watch a channel for questions and draft sourced, in-thread answers from your knowledge base.',
      content:
        '# Slack Question Responder\n\nMonitor a support or help channel and answer incoming questions.\n\n## Steps\n1. Detect when a message is a genuine question (ends in a question mark, asks "how/where/can someone", or is a help request).\n2. Search the connected knowledge base for the answer.\n3. If a confident answer exists, draft a concise reply in the thread with the answer and a citation/link to the source.\n4. If no confident answer exists, do not guess — post a short note that a human should help, and @-mention the channel owner.\n\n## Guidance\n- Always reply in-thread, never in the main channel.\n- Keep answers to 2–4 sentences plus the source link.\n- Never fabricate links or policy.',
    },
    {
      name: 'escalate-urgent-messages',
      description:
        'Scan a channel for urgent or at-risk messages and surface them to the right owner.',
      content:
        '# Escalate Urgent Messages\n\nTriage a channel for messages that need fast attention.\n\n## Steps\n1. Review recent messages and classify each as **Urgent**, **Today**, or **FYI** based on signals like "blocked", "down", "ASAP", customer impact, or an unanswered direct ask.\n2. For Urgent items, identify the most likely owner from the channel topic or message context.\n3. Skip resolved threads (those with a ✅ reaction or a clear answer).\n\n## Output\nPost a short escalation summary listing only Urgent and Today items: each as a one-line description, an @-mention of the owner, and a link to the message. If nothing is urgent, say so in one line.',
    },
  ],
} as const satisfies BlockMeta
