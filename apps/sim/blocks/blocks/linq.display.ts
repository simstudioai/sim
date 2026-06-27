import { LinqIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const LinqBlockDisplay = {
  type: 'linq',
  name: 'Linq',
  description: 'Send iMessage, SMS, and RCS messages and manage conversations with Linq',
  category: 'tools',
  bgColor: '#000000',
  icon: LinqIcon,
  longDescription:
    'Reach people on iMessage, SMS, and RCS through Linq. Start chats, send messages with media, links, effects, and replies, send voice memos, react with tapbacks, manage group participants, check iMessage/RCS capability, configure contact cards, and subscribe to webhook events — all through a single Linq API key.',
  docsLink: 'https://docs.sim.ai/integrations/linq',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const LinqBlockMeta = {
  tags: ['messaging', 'automation', 'webhooks'],
  url: 'https://www.linqapp.com',
  templates: [
    {
      icon: LinqIcon,
      title: 'Linq iMessage campaign sender',
      prompt:
        'Build a workflow that reads a contact list from a table, composes a personalized iMessage for each recipient using an agent, and sends them via Linq in batches.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['messaging', 'automation'],
    },
    {
      icon: LinqIcon,
      title: 'Linq SMS support responder',
      prompt:
        'Create a scheduled workflow that lists recent unread Linq messages, generates a reply for each with an agent, and sends the response back to the same chat.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['messaging', 'support'],
    },
    {
      icon: LinqIcon,
      title: 'Linq RCS notification dispatcher',
      prompt:
        'Build a workflow that monitors a table for new alert rows, formats an RCS notification for each, and dispatches it to the relevant phone number via Linq.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation'],
    },
  ],
  skills: [
    {
      name: 'send-personalized-message',
      description:
        'Start a Linq chat and send a personalized iMessage, SMS, or RCS message to a recipient.',
      content:
        '# Send Personalized Message\n\nReach a person on iMessage, SMS, or RCS through Linq.\n\n## Steps\n1. Create Chat with your sending number in From and the recipient handle in To.\n2. Draft a friendly, concise message body tailored to the recipient.\n3. Send Message to the chat with the message text, optionally setting a preferred service or media URL.\n4. Optionally Check iMessage or Check RCS first to pick the best service for the recipient.\n\n## Output\nThe chat ID, the message ID, the delivery service used, and the delivery status.',
    },
    {
      name: 'respond-to-unread-messages',
      description:
        'List recent Linq chats and messages, draft a reply for each unread conversation, and send it.',
      content:
        '# Respond to Unread Messages\n\nClear an inbox by replying to recent unread Linq conversations.\n\n## Steps\n1. List Chats to find active conversations, then List Messages per chat to find unread inbound messages.\n2. For each conversation needing a reply, read the recent thread for context.\n3. Draft a relevant reply.\n4. Send Message to that chat ID with the drafted text.\n\n## Output\nFor each handled chat: the chat ID, the reply sent, and the delivery status.',
    },
    {
      name: 'dispatch-alert-notifications',
      description:
        'Send an RCS or SMS notification to one or more recipients from a list of alerts.',
      content:
        '# Dispatch Alert Notifications\n\nFan out notifications to recipients through Linq.\n\n## Steps\n1. Take the list of recipients and the alert content to send.\n2. For each recipient, Create Chat from your sending number to their handle.\n3. Format a clear notification message and Send Message, setting the preferred service to RCS or SMS as needed.\n4. Use an idempotency key per message so retries do not double-send.\n\n## Output\nA per-recipient list of chat IDs, message IDs, and delivery statuses.',
    },
  ],
} as const satisfies BlockMeta
