import { SESIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SESBlockDisplay = {
  type: 'ses',
  name: 'AWS SES',
  description: 'Send emails and manage templates with AWS Simple Email Service',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: SESIcon,
  longDescription:
    'Integrate AWS SES v2 into the workflow. Send simple, templated, and bulk emails. Manage email templates and retrieve account sending quota and verified identity information.',
  docsLink: 'https://docs.sim.ai/integrations/ses',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay

export const SESBlockMeta = {
  tags: ['cloud', 'email-marketing', 'messaging'],
  url: 'https://aws.amazon.com/ses',
  templates: [
    {
      icon: SESIcon,
      title: 'SES bulk announcement',
      prompt:
        'Create a workflow that takes a recipient list from a table and an SES email template, sends the announcement using SES bulk send with per-recipient template data, and writes the per-recipient send status back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: SESIcon,
      title: 'SES verified-identity audit',
      prompt:
        'Build a scheduled workflow that lists AWS SES verified identities, checks the account sending quota and reputation, and posts a Slack report when any identity is unverified or the account approaches the daily quota.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SESIcon,
      title: 'SES templated nurture',
      prompt:
        'Create a workflow that walks each contact in a tables-based nurture sequence through staged SES templated sends with delays between steps, branches on open or click, and stops the sequence when the contact replies.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: SESIcon,
      title: 'SES + Mailgun multi-region sender',
      prompt:
        'Build a workflow that routes transactional emails through SES in primary regions and through Mailgun for regions where SES is not provisioned, normalizing template variables and writing one unified send log to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'infrastructure', 'automation'],
      alsoIntegrations: ['mailgun'],
    },
    {
      icon: SESIcon,
      title: 'SES + AgentMail customer concierge',
      prompt:
        'Create a workflow that sends outbound customer messages through AWS SES but provisions a per-customer AgentMail inbox to receive replies, threads conversations across both, and tags AgentMail threads with the customer ID.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['agentmail'],
    },
    {
      icon: SESIcon,
      title: 'SES domain reputation monitor',
      prompt:
        'Build a scheduled daily workflow that pulls SES account sending statistics and per-identity reputation indicators, logs them to a tracking table for trend lines, and flags any identity whose complaint or bounce rate is trending up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'analysis'],
    },
    {
      icon: SESIcon,
      title: 'SES template library sync',
      prompt:
        'Build a workflow that reads my approved email templates from a table, creates or updates each one in AWS SES with create template, lists existing SES templates to detect drift, and deletes templates that have been removed from the table so the SES library stays in sync.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['marketing', 'automation', 'content'],
    },
  ],
  skills: [
    {
      name: 'send-notification-email',
      description:
        'Send a transactional email through AWS SES to one or more recipients. Use for alerts, confirmations, and one-off notifications from a workflow.',
      content:
        '# Send Notification Email\n\nSend a transactional email via SES.\n\n## Steps\n1. Determine the verified sender identity, the recipients, subject, and body.\n2. Choose a plain-text or HTML body to match the message.\n3. Send the email, including reply-to or CC recipients if needed.\n4. Confirm the send succeeded and capture the message ID.\n\n## Output\nReport the SES message ID and the recipients. If the send was rejected, surface the SES error (for example, an unverified sender or sandbox restriction).',
    },
    {
      name: 'send-templated-campaign',
      description:
        'Send a templated SES email to many recipients with per-recipient personalization. Use for newsletters, onboarding sequences, and bulk notifications.',
      content:
        "# Send Templated Campaign\n\nSend personalized emails using an SES template.\n\n## Steps\n1. Confirm the template exists with get template, or create it first.\n2. Assemble the recipient list with each recipient's template data for personalization.\n3. Use send bulk email for many recipients, or send templated email for a single message.\n4. Collect per-recipient send status.\n\n## Output\nReport how many messages were accepted versus failed, with message IDs and the reason for any failures.",
    },
    {
      name: 'manage-email-templates',
      description:
        'Create, fetch, list, and delete reusable email templates in AWS SES. Use to maintain a consistent, version-controlled template library.',
      content:
        '# Manage Email Templates\n\nMaintain the SES template library.\n\n## Steps\n1. To add a template, create it with a name, subject, and HTML and text parts using placeholder variables.\n2. To review, get a template by name or list templates.\n3. To retire one, delete the template by name.\n4. Keep template names descriptive so they are easy to reference when sending.\n\n## Output\nReport the template name affected and the action taken, or the template contents for a fetch.',
    },
    {
      name: 'check-sending-health',
      description:
        'Inspect AWS SES account sending limits, quota usage, and verified identities. Use to confirm capacity and deliverability readiness before a send.',
      content:
        '# Check Sending Health\n\nVerify SES is ready to send.\n\n## Steps\n1. Get the account to read the sending quota, send rate, and whether the account is out of the sandbox.\n2. List identities to confirm the intended sender domain or address is verified.\n3. Compare planned volume against the remaining 24-hour quota.\n4. Flag any blockers — sandbox mode, unverified senders, or quota nearly exhausted.\n\n## Output\nReport sending enabled status, quota used versus max, and any unverified identities that would block the send.',
    },
  ],
} as const satisfies BlockMeta
