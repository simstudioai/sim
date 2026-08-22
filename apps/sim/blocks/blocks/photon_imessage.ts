import { PhotonIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

/** A send targets either a new/existing DM by address, or an existing chat by GUID. */
const RECIPIENT_FIELD = ['to', 'chatId'] as const

export const PhotonImessageBlock: BlockConfig = {
  type: 'photon_imessage',
  name: 'iMessage (Photon)',
  description: 'Send and receive iMessage',
  longDescription:
    'Send iMessages from a Photon-managed number and trigger workflows on inbound messages. Photon runs the iMessage line, so no Mac is required. Reply into an existing conversation with the chat ID from the trigger, or start one from a phone number or Apple ID email.',
  docsLink: 'https://docs.sim.ai/integrations/photon_imessage',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#0B84FE',
  icon: PhotonIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'iMessage',
    sentences: {
      default: [
        { text: 'Send', field: 'text', core: true },
        { text: 'to', field: RECIPIENT_FIELD, core: true },
      ],
    },
  },

  subBlocks: [
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Your Photon project ID',
      description: 'Found in your project settings at app.photon.codes.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
    },
    {
      id: 'projectSecret',
      title: 'Project Secret',
      type: 'short-input',
      placeholder: 'Your Photon project secret',
      description:
        'Authorizes Photon API access. This is a different credential from the webhook signing secret used by the trigger.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
    },
    {
      id: 'to',
      title: 'Recipient',
      type: 'short-input',
      placeholder: 'e.g. +14155551234 or name@example.com',
      description:
        'Phone number in E.164 form or an Apple ID email. Starts or reuses a direct conversation. Leave empty when sending to a chat ID.',
    },
    {
      id: 'chatId',
      title: 'Chat ID',
      type: 'short-input',
      placeholder: 'e.g. any;-;+14155551234',
      description:
        'Existing chat GUID, such as the chatId from an iMessage trigger. Required to reach a group chat. Leave empty when sending to a recipient.',
      mode: 'advanced',
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Message to send',
      description: 'iMessage is plain text, so Markdown is not rendered.',
      required: true,
    },
    ...getTrigger('photon_imessage_message_received').subBlocks,
  ],

  tools: {
    access: ['photon_imessage_send_message'],
    config: {
      tool: () => 'photon_imessage_send_message',
      params: (params) => ({
        projectId: params.projectId,
        projectSecret: params.projectSecret,
        to: params.to || undefined,
        chatId: params.chatId || undefined,
        text: params.text,
      }),
    },
  },

  inputs: {
    projectId: { type: 'string', description: 'Photon project ID' },
    projectSecret: { type: 'string', description: 'Photon project secret' },
    to: { type: 'string', description: 'Recipient phone number or Apple ID email' },
    chatId: { type: 'string', description: 'Existing chat GUID to send into' },
    text: { type: 'string', description: 'Message text to send' },
  },

  outputs: {
    messageId: { type: 'string', description: 'Identifier of the sent message' },
    chatId: {
      type: 'string',
      description: 'Chat GUID the message was sent to. Pass this back to reply into the same chat.',
    },
    timestamp: { type: 'string', description: 'ISO 8601 time the message was sent' },
    text: { type: 'string', description: 'Text of the received message' },
    contentType: { type: 'string', description: 'Content arm of the received message' },
    senderId: { type: 'string', description: 'Phone number or email of the sender' },
    chatType: { type: 'string', description: 'Conversation type, dm or group' },
    platform: { type: 'string', description: 'Photon platform that delivered the message' },
    attachments: { type: 'json', description: 'Attachment metadata on the received message' },
    raw: { type: 'string', description: 'Complete raw webhook payload as a JSON string' },
  },

  triggers: {
    enabled: true,
    available: ['photon_imessage_message_received'],
  },
}

export const PhotonImessageBlockMeta = {
  tags: ['messaging', 'automation', 'webhooks'],
  url: 'https://photon.codes',
  templates: [
    {
      icon: PhotonIcon,
      title: 'iMessage support agent',
      prompt:
        'Build a workflow triggered when an iMessage is received that looks up the sender in the knowledge base, drafts an answer with an agent, and sends the reply back to the same chat.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'support',
      tags: ['messaging', 'support', 'automation'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage appointment reminders',
      prompt:
        'Build a scheduled workflow that reads tomorrow’s appointments from a table each afternoon and texts every attendee a personalized iMessage reminder with the time and location.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation', 'scheduling'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage lead follow-up',
      prompt:
        'Build a workflow that fires when a new lead submits a form, drafts a short friendly intro with an agent, and sends it as an iMessage within seconds so reps reach leads while interest is high.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['messaging', 'sales', 'automation'],
      alsoIntegrations: ['typeform'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage escalation to Slack',
      prompt:
        'Build a workflow triggered when an iMessage is received that classifies sentiment, and posts the conversation to a Slack channel when a message reads as urgent or angry so a human can take over.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['messaging', 'support', 'escalation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage order updates',
      prompt:
        'Build a workflow that fires when an order status changes, formats a short status update, and sends it to the customer as an iMessage with a link to track the shipment.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['messaging', 'notifications', 'automation'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage feedback collection',
      prompt:
        'Build a workflow that texts customers an iMessage asking how their visit went, then classifies each inbound reply as positive or negative and appends the result to a table.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation', 'feedback'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage on-call alerts',
      prompt:
        'Build a workflow that fires when a monitoring alert arrives, sends the on-call engineer an iMessage with the incident summary, and records their reply as the acknowledgement.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['messaging', 'incident-management', 'automation'],
    },
  ],
} as const satisfies BlockMeta
