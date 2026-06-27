import { TelegramIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TelegramBlockDisplay = {
  type: 'telegram',
  name: 'Telegram',
  description: 'Interact with Telegram',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: TelegramIcon,
  longDescription:
    'Integrate Telegram into the workflow. Can send and delete messages. Can be used in trigger mode to trigger a workflow when a message is sent to a chat.',
  docsLink: 'https://docs.sim.ai/integrations/telegram',
  integrationType: IntegrationType.Communication,
  triggerAllowed: true,
} satisfies BlockDisplay

export const TelegramBlockMeta = {
  tags: ['messaging', 'webhooks', 'automation'],
  url: 'https://telegram.org',
  templates: [
    {
      icon: TelegramIcon,
      title: 'Telegram alert relay',
      prompt:
        'Build a workflow that listens for critical alerts from Sentry or PagerDuty and forwards a concise summary with severity, link, and the on-call person to a Telegram group.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['sentry', 'pagerduty'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram price-action notifier',
      prompt:
        'Create a scheduled workflow that watches tracked assets in a table for price thresholds and pushes a Telegram message with the trigger, price, and a link to the chart.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram support bot',
      prompt:
        'Build a Telegram bot that answers product questions using a knowledge base with citations, escalates to a human via Intercom when it cannot answer, and logs every conversation to a table.',
      modules: ['knowledge-base', 'tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['intercom'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram daily standup poller',
      prompt:
        'Create a scheduled workflow that posts a daily standup prompt to a Telegram group, collects the replies, and writes a structured standup digest to a Google Doc.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram broadcast scheduler',
      prompt:
        'Build a workflow that reads a tables-based content calendar and posts scheduled Telegram channel messages with formatted text, images, and links at the right time.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram form-reply collector',
      prompt:
        'Create a workflow that asks structured questions in Telegram one at a time, parses replies into fields, and saves the completed response as a row in a Sim table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram + WhatsApp dual-channel notifier',
      prompt:
        'Build a workflow that sends critical operational alerts via both Telegram and WhatsApp based on user preference per recipient, and writes delivery status to a table.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['communication', 'monitoring'],
      alsoIntegrations: ['whatsapp'],
    },
  ],
  skills: [
    {
      name: 'send-alert-message',
      description: 'Post a formatted alert or notification to a Telegram chat or channel.',
      content:
        '# Send a Telegram Alert\n\nDeliver a timely notification to a Telegram chat, group, or channel.\n\n## Steps\n1. Use the Send Message operation with your Bot Token and the target Chat ID.\n2. Compose the Message with the essentials up front: what happened, severity, and a link for follow-up.\n3. To find a Chat ID, add the bot to the chat, send a message, then read the chat field from the getUpdates response.\n4. For recurring alerts, build the message from upstream block outputs so each notification carries live context.\n\n## Output\nReturn the sent message ID and chat ID so the run can be traced or the message later deleted.',
    },
    {
      name: 'send-media-message',
      description:
        'Send a photo, video, document, or audio file to a Telegram chat with a caption.',
      content:
        '# Send Media to Telegram\n\nDeliver a file such as a chart, report, or image to a Telegram chat.\n\n## Steps\n1. Pick the matching operation: Send Photo, Send Video, Send Audio, Send Animation, or Send Document.\n2. Provide the Bot Token and Chat ID.\n3. Upload the file directly, or reference a file produced by a previous block (for example a generated PDF or chart image).\n4. Add an optional Caption describing the attachment.\n\n## Output\nConfirm delivery and return the message ID so the media post can be referenced later.',
    },
    {
      name: 'route-incoming-message',
      description: 'Trigger a workflow when a Telegram message arrives and act on its content.',
      content:
        '# Route an Incoming Telegram Message\n\nUse Telegram as a trigger so the workflow runs whenever a user messages the bot.\n\n## Steps\n1. Enable the Telegram webhook trigger so incoming messages start the workflow.\n2. Read the trigger outputs: text, from_username, chat_id, and chat_type.\n3. Branch on the message content (for example detect a command or a support question) to decide the next action.\n4. Reply with the Send Message operation using the chat_id from the trigger.\n\n## Output\nReturn the parsed incoming message fields and confirm the reply that was sent back to the user.',
    },
  ],
} as const satisfies BlockMeta
