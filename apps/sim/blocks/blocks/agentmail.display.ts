import { AgentMailIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AgentMailBlockDisplay = {
  type: 'agentmail',
  name: 'AgentMail',
  description: 'Manage email inboxes, threads, and messages with AgentMail',
  category: 'tools',
  bgColor: '#000000',
  icon: AgentMailIcon,
  longDescription:
    'Integrate AgentMail into your workflow. Create and manage email inboxes, send and receive messages, reply to threads, manage drafts, and organize threads with labels. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/agentmail',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const AgentMailBlockMeta = {
  tags: ['messaging', 'automation'],
  url: 'https://agentmail.to',
  templates: [
    {
      icon: AgentMailIcon,
      title: 'AgentMail inbox-per-customer',
      prompt:
        'Build a workflow that creates a dedicated AgentMail inbox for every new customer account, configures the display name and labels, and writes the inbox address back to the customer record so all customer email is isolated and threaded.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'enterprise'],
    },
    {
      icon: AgentMailIcon,
      title: 'AgentMail support concierge',
      prompt:
        'Create a knowledge base from product docs and past resolutions, then build a scheduled workflow that polls an AgentMail inbox for new threads, drafts a contextual reply with citations, and either sends it or saves it as a draft based on confidence.',
      modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'communication'],
    },
    {
      icon: AgentMailIcon,
      title: 'AgentMail draft assistant',
      prompt:
        'Build a scheduled workflow that polls AgentMail threads, drafts a reply that matches my tone using my recent sent messages as reference, and updates the existing draft each time the thread receives a new message so the draft stays current.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication', 'automation'],
    },
    {
      icon: AgentMailIcon,
      title: 'AgentMail label organizer',
      prompt:
        'Create a workflow that classifies new AgentMail messages by topic and customer tier, applies the matching thread labels, and moves threads with stale labels into archive labels on a weekly schedule.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'team'],
    },
    {
      icon: AgentMailIcon,
      title: 'AgentMail + Loops support touch-points',
      prompt:
        'Create a scheduled workflow that polls AgentMail support threads and sends a Loops event for each customer milestone — first contact, resolved, escalated — so Loops can automate the right follow-up email based on real support outcomes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: AgentMailIcon,
      title: 'AgentMail outbound sequence sender',
      prompt:
        'Build a workflow that reads a prospects table, creates a personalized AgentMail draft per contact using their enriched profile, sends the message from a dedicated inbox, and logs the thread ID back to the row so replies can be tracked.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'communication'],
    },
    {
      icon: AgentMailIcon,
      title: 'AgentMail thread escalation router',
      prompt:
        'Create a scheduled workflow that polls AgentMail inboxes for new messages, detects urgent or negative threads with an agent, forwards the full thread to the on-call address, and posts a Slack alert so nothing high-priority sits unanswered.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'triage-inbox-messages',
      description:
        'Read new messages in an AgentMail inbox, classify them, and reply or escalate as needed.',
      content:
        '# Triage Inbox Messages\n\nProcess unread email in an AgentMail inbox and act on each thread.\n\n## Steps\n1. List recent messages in the inbox and identify which threads are unread or unanswered.\n2. Read each thread for context including prior replies.\n3. Classify intent (question, request, spam, follow-up needed) and urgency.\n4. Draft and send a reply on the thread for routine items, or escalate by flagging the ones needing a human.\n\n## Output\nA summary of threads handled: who, the classification, and the action taken (replied, escalated, ignored).',
    },
    {
      name: 'extract-verification-code',
      description:
        'Read a verification or OTP email in an AgentMail inbox and extract the code or confirmation link.',
      content:
        '# Extract Verification Code\n\nPull a 2FA/OTP code or confirmation link from an email so an agent can complete a signup or login flow.\n\n## Steps\n1. Search the inbox for the most recent message from the expected sender or matching the subject.\n2. Read the message body and extract the verification code or the confirmation URL.\n3. Return only the code or link.\n\n## Output\nThe extracted code or link. If multiple recent matches exist, return the newest and note its timestamp.',
    },
    {
      name: 'send-and-track-outreach',
      description:
        'Send an email from an AgentMail inbox and monitor the thread for a reply to continue the conversation.',
      content:
        '# Send and Track Outreach\n\nSend an outbound email and follow the resulting thread.\n\n## Steps\n1. Compose the message with a clear subject and body from the provided details.\n2. Send it from the AgentMail inbox to the recipient.\n3. Check the thread for a reply; when one arrives, read it and determine the next action.\n\n## Output\nConfirm the message was sent with the thread ID. When a reply arrives, summarize it and recommend the next step.',
    },
  ],
} as const satisfies BlockMeta
