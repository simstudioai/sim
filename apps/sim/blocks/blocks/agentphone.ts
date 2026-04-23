import { toError } from '@sim/utils/errors'
import { AgentPhoneIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const CONVERSATION_OPS = [
  'get_conversation',
  'update_conversation',
  'get_conversation_messages',
] as const

const CONTACT_ID_OPS = ['get_contact', 'update_contact', 'delete_contact'] as const

const CALL_ID_OPS = ['get_call', 'get_call_transcript'] as const

const NUMBER_ID_OPS = ['release_number', 'get_number_messages'] as const

const OFFSET_LIMIT_OPS = [
  'list_numbers',
  'list_calls',
  'list_conversations',
  'list_contacts',
] as const

const CURSOR_MESSAGE_OPS = ['get_number_messages', 'get_conversation_messages'] as const

export const AgentPhoneBlock: BlockConfig = {
  type: 'agentphone',
  name: 'AgentPhone',
  description: 'Provision numbers, send SMS and iMessage, and place voice calls with AgentPhone',
  longDescription:
    'Give your workflow a phone. Provision SMS- and voice-enabled numbers, send messages and tapback reactions, place outbound voice calls, manage conversations and contacts, and track usage — all through a single AgentPhone API key.',
  docsLink: 'https://docs.sim.ai/tools/agentphone',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  tags: ['messaging', 'automation'],
  bgColor: 'linear-gradient(135deg, #050505 0%, #003d20 55%, #00e676 100%)',
  icon: AgentPhoneIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Number', id: 'create_number' },
        { label: 'List Numbers', id: 'list_numbers' },
        { label: 'Release Number', id: 'release_number' },
        { label: 'Get Number Messages', id: 'get_number_messages' },
        { label: 'Create Call', id: 'create_call' },
        { label: 'List Calls', id: 'list_calls' },
        { label: 'Get Call', id: 'get_call' },
        { label: 'Get Call Transcript', id: 'get_call_transcript' },
        { label: 'List Conversations', id: 'list_conversations' },
        { label: 'Get Conversation', id: 'get_conversation' },
        { label: 'Update Conversation', id: 'update_conversation' },
        { label: 'Get Conversation Messages', id: 'get_conversation_messages' },
        { label: 'Send Message', id: 'send_message' },
        { label: 'React to Message', id: 'react_to_message' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Delete Contact', id: 'delete_contact' },
        { label: 'Get Usage', id: 'get_usage' },
        { label: 'Get Daily Usage', id: 'get_usage_daily' },
        { label: 'Get Monthly Usage', id: 'get_usage_monthly' },
      ],
      value: () => 'create_number',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your AgentPhone API key',
      required: true,
      password: true,
    },

    // Numbers - Create
    {
      id: 'country',
      title: 'Country',
      type: 'dropdown',
      options: [
        { label: 'United States (US)', id: 'US' },
        { label: 'Canada (CA)', id: 'CA' },
      ],
      value: () => 'US',
      condition: { field: 'operation', value: 'create_number' },
    },
    {
      id: 'areaCode',
      title: 'Area Code',
      type: 'short-input',
      placeholder: '415 (US/CA only, optional)',
      condition: { field: 'operation', value: 'create_number' },
      mode: 'advanced',
    },
    {
      id: 'attachAgentId',
      title: 'Agent ID',
      type: 'short-input',
      placeholder: 'Attach the number to this agent (optional)',
      condition: { field: 'operation', value: 'create_number' },
      mode: 'advanced',
    },

    // Numbers - shared numberId
    {
      id: 'numberId',
      title: 'Phone Number ID',
      type: 'short-input',
      placeholder: 'num_xxx',
      condition: { field: 'operation', value: [...NUMBER_ID_OPS] },
      required: { field: 'operation', value: [...NUMBER_ID_OPS] },
    },

    // Calls - Create
    {
      id: 'callAgentId',
      title: 'Agent ID',
      type: 'short-input',
      placeholder: 'agt_xxx',
      condition: { field: 'operation', value: 'create_call' },
      required: { field: 'operation', value: 'create_call' },
    },
    {
      id: 'toNumberCall',
      title: 'To Phone Number',
      type: 'short-input',
      placeholder: '+14155551234',
      condition: { field: 'operation', value: 'create_call' },
      required: { field: 'operation', value: 'create_call' },
    },
    {
      id: 'fromNumberId',
      title: 'From Phone Number ID',
      type: 'short-input',
      placeholder: "num_xxx (defaults to the agent's first number)",
      condition: { field: 'operation', value: 'create_call' },
      mode: 'advanced',
    },
    {
      id: 'initialGreeting',
      title: 'Initial Greeting',
      type: 'long-input',
      placeholder: 'Hi, this is Acme Corp calling about your recent order.',
      condition: { field: 'operation', value: 'create_call' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a short, natural-sounding phone greeting for an AI agent to speak when the recipient answers. Keep it under 2 sentences. Return ONLY the greeting text - no explanations, no extra text.',
        placeholder: 'Describe the greeting tone and purpose...',
      },
    },
    {
      id: 'voice',
      title: 'Voice',
      type: 'short-input',
      placeholder: "Polly.Amy (defaults to the agent's configured voice)",
      condition: { field: 'operation', value: 'create_call' },
      mode: 'advanced',
    },
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      placeholder: 'You are a friendly support agent from Acme Corp...',
      condition: { field: 'operation', value: 'create_call' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a concise system prompt for an AI phone agent. Describe personality, objective, and constraints clearly. Return ONLY the prompt text - no explanations, no extra text.',
        placeholder: 'Describe the agent persona and objective...',
      },
    },

    // Calls - shared callId
    {
      id: 'callId',
      title: 'Call ID',
      type: 'short-input',
      placeholder: 'call_xxx',
      condition: { field: 'operation', value: [...CALL_ID_OPS] },
      required: { field: 'operation', value: [...CALL_ID_OPS] },
    },

    // Calls - list filters
    {
      id: 'callsStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Completed', id: 'completed' },
        { label: 'In Progress', id: 'in-progress' },
        { label: 'Failed', id: 'failed' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_calls' },
      mode: 'advanced',
    },
    {
      id: 'callsDirection',
      title: 'Direction Filter',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Inbound', id: 'inbound' },
        { label: 'Outbound', id: 'outbound' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_calls' },
      mode: 'advanced',
    },
    {
      id: 'callsType',
      title: 'Type Filter',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'PSTN', id: 'pstn' },
        { label: 'Web', id: 'web' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_calls' },
      mode: 'advanced',
    },
    {
      id: 'callsSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Phone number to match against fromNumber or toNumber',
      condition: { field: 'operation', value: 'list_calls' },
      mode: 'advanced',
    },

    // Conversations - shared conversationId
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'conv_xxx',
      condition: { field: 'operation', value: [...CONVERSATION_OPS] },
      required: { field: 'operation', value: [...CONVERSATION_OPS] },
    },
    {
      id: 'messageLimit',
      title: 'Message Limit',
      type: 'short-input',
      placeholder: '50 (max 100)',
      condition: { field: 'operation', value: 'get_conversation' },
      mode: 'advanced',
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'long-input',
      placeholder: '{"customerName":"Jane","orderId":"ORD-12345"}',
      condition: { field: 'operation', value: 'update_conversation' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a valid JSON object to store on the conversation as metadata. Use flat string/number values where possible. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the fields to store (customer name, order ID, topic)...',
      },
    },

    // Messages - Send
    {
      id: 'sendAgentId',
      title: 'Agent ID',
      type: 'short-input',
      placeholder: 'agt_xxx',
      condition: { field: 'operation', value: 'send_message' },
      required: { field: 'operation', value: 'send_message' },
    },
    {
      id: 'toNumberMessage',
      title: 'To Phone Number',
      type: 'short-input',
      placeholder: '+14155551234',
      condition: { field: 'operation', value: 'send_message' },
      required: { field: 'operation', value: 'send_message' },
    },
    {
      id: 'messageBody',
      title: 'Message Body',
      type: 'long-input',
      placeholder: 'Hi! Your appointment is confirmed for tomorrow at 3 PM.',
      condition: { field: 'operation', value: 'send_message' },
      required: { field: 'operation', value: 'send_message' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a friendly, concise SMS or iMessage body. Keep it under 160 characters where possible. Return ONLY the message text - no explanations, no extra text.',
        placeholder: 'Describe the message purpose and tone...',
      },
    },
    {
      id: 'mediaUrl',
      title: 'Media URL',
      type: 'short-input',
      placeholder: 'https://cdn.example.com/image.png (optional)',
      condition: { field: 'operation', value: 'send_message' },
      mode: 'advanced',
    },
    {
      id: 'sendNumberId',
      title: 'From Phone Number ID',
      type: 'short-input',
      placeholder: "num_xxx (defaults to the agent's first number)",
      condition: { field: 'operation', value: 'send_message' },
      mode: 'advanced',
    },

    // Messages - React
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'msg_xxx',
      condition: { field: 'operation', value: 'react_to_message' },
      required: { field: 'operation', value: 'react_to_message' },
    },
    {
      id: 'reaction',
      title: 'Reaction',
      type: 'dropdown',
      options: [
        { label: 'Love', id: 'love' },
        { label: 'Like', id: 'like' },
        { label: 'Dislike', id: 'dislike' },
        { label: 'Laugh', id: 'laugh' },
        { label: 'Emphasize', id: 'emphasize' },
        { label: 'Question', id: 'question' },
      ],
      value: () => 'love',
      condition: { field: 'operation', value: 'react_to_message' },
      required: { field: 'operation', value: 'react_to_message' },
    },

    // Contacts - Create / Update shared fields
    {
      id: 'contactPhoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+14155551234',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      required: { field: 'operation', value: 'create_contact' },
    },
    {
      id: 'contactName',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Alice Johnson',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      required: { field: 'operation', value: 'create_contact' },
    },
    {
      id: 'contactEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'alice@example.com (optional)',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      mode: 'advanced',
    },
    {
      id: 'contactNotes',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Freeform notes (optional)',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      mode: 'advanced',
    },

    // Contacts - shared contactId
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'contact_xxx',
      condition: { field: 'operation', value: [...CONTACT_ID_OPS] },
      required: { field: 'operation', value: [...CONTACT_ID_OPS] },
    },
    {
      id: 'contactsSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter by name or phone number',
      condition: { field: 'operation', value: 'list_contacts' },
      mode: 'advanced',
    },

    // Pagination - offset/limit for list_* operations
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20 (max 100)',
      condition: { field: 'operation', value: [...OFFSET_LIMIT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: [...OFFSET_LIMIT_OPS] },
      mode: 'advanced',
    },

    // Pagination - limit/before/after for message endpoints
    {
      id: 'messagesLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50 (max 200)',
      condition: { field: 'operation', value: [...CURSOR_MESSAGE_OPS] },
      mode: 'advanced',
    },
    {
      id: 'before',
      title: 'Before',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (e.g. 2025-01-15T12:00:00Z)',
      condition: { field: 'operation', value: [...CURSOR_MESSAGE_OPS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the natural-language time description to an ISO 8601 timestamp (UTC). Return ONLY the timestamp - no explanations, no extra text.',
        placeholder: 'Describe the cutoff time (e.g. 2 hours ago)...',
      },
    },
    {
      id: 'after',
      title: 'After',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (e.g. 2025-01-15T12:00:00Z)',
      condition: { field: 'operation', value: [...CURSOR_MESSAGE_OPS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the natural-language time description to an ISO 8601 timestamp (UTC). Return ONLY the timestamp - no explanations, no extra text.',
        placeholder: 'Describe the start time (e.g. 2 hours ago)...',
      },
    },

    // Usage
    {
      id: 'usageDays',
      title: 'Days',
      type: 'short-input',
      placeholder: '30 (1-365)',
      condition: { field: 'operation', value: 'get_usage_daily' },
      mode: 'advanced',
    },
    {
      id: 'usageMonths',
      title: 'Months',
      type: 'short-input',
      placeholder: '6 (1-24)',
      condition: { field: 'operation', value: 'get_usage_monthly' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'agentphone_create_call',
      'agentphone_create_contact',
      'agentphone_create_number',
      'agentphone_delete_contact',
      'agentphone_get_call',
      'agentphone_get_call_transcript',
      'agentphone_get_contact',
      'agentphone_get_conversation',
      'agentphone_get_conversation_messages',
      'agentphone_get_number_messages',
      'agentphone_get_usage',
      'agentphone_get_usage_daily',
      'agentphone_get_usage_monthly',
      'agentphone_list_calls',
      'agentphone_list_contacts',
      'agentphone_list_conversations',
      'agentphone_list_numbers',
      'agentphone_react_to_message',
      'agentphone_release_number',
      'agentphone_send_message',
      'agentphone_update_contact',
      'agentphone_update_conversation',
    ],
    config: {
      tool: (params) => `agentphone_${params.operation || 'create_number'}`,
      params: (params) => {
        const {
          operation,
          attachAgentId,
          callAgentId,
          toNumberCall,
          toNumberMessage,
          sendAgentId,
          sendNumberId,
          messageBody,
          contactPhoneNumber,
          contactName,
          contactEmail,
          contactNotes,
          contactsSearch,
          callsStatus,
          callsDirection,
          callsType,
          callsSearch,
          messageLimit,
          messagesLimit,
          limit,
          offset,
          usageDays,
          usageMonths,
          metadata,
          ...rest
        } = params

        if (operation === 'create_number' && attachAgentId) {
          rest.agentId = attachAgentId
        }

        if (operation === 'create_call') {
          if (callAgentId) rest.agentId = callAgentId
          if (toNumberCall) rest.toNumber = toNumberCall
        }

        if (operation === 'send_message') {
          if (sendAgentId) rest.agentId = sendAgentId
          if (toNumberMessage) rest.toNumber = toNumberMessage
          if (sendNumberId) rest.numberId = sendNumberId
          if (messageBody !== undefined) rest.body = messageBody
        }

        if (['create_contact', 'update_contact'].includes(operation as string)) {
          if (contactPhoneNumber) rest.phoneNumber = contactPhoneNumber
          if (contactName) rest.name = contactName
          if (contactEmail) rest.email = contactEmail
          if (contactNotes) rest.notes = contactNotes
        }

        if (operation === 'list_contacts' && contactsSearch !== undefined) {
          rest.search = contactsSearch
        }

        if (operation === 'list_calls') {
          if (callsStatus) rest.status = callsStatus
          if (callsDirection) rest.direction = callsDirection
          if (callsType) rest.type = callsType
          if (callsSearch) rest.search = callsSearch
        }

        const toFiniteNumber = (value: unknown, field: string): number => {
          const parsed = Number(value)
          if (!Number.isFinite(parsed)) {
            throw new Error(`Invalid numeric value for ${field}: ${String(value)}`)
          }
          return parsed
        }

        if (operation === 'get_conversation' && messageLimit !== undefined && messageLimit !== '') {
          rest.messageLimit = toFiniteNumber(messageLimit, 'Message Limit')
        }

        if (
          (operation === 'get_number_messages' || operation === 'get_conversation_messages') &&
          messagesLimit !== undefined &&
          messagesLimit !== ''
        ) {
          rest.limit = toFiniteNumber(messagesLimit, 'Limit')
        }

        if (
          OFFSET_LIMIT_OPS.includes(operation as (typeof OFFSET_LIMIT_OPS)[number]) &&
          limit !== undefined &&
          limit !== ''
        ) {
          rest.limit = toFiniteNumber(limit, 'Limit')
        }

        if (
          OFFSET_LIMIT_OPS.includes(operation as (typeof OFFSET_LIMIT_OPS)[number]) &&
          offset !== undefined &&
          offset !== ''
        ) {
          rest.offset = toFiniteNumber(offset, 'Offset')
        }

        if (operation === 'get_usage_daily' && usageDays !== undefined && usageDays !== '') {
          rest.days = toFiniteNumber(usageDays, 'Days')
        }

        if (operation === 'get_usage_monthly' && usageMonths !== undefined && usageMonths !== '') {
          rest.months = toFiniteNumber(usageMonths, 'Months')
        }

        if (operation === 'update_conversation' && metadata !== undefined) {
          if (metadata === null || metadata === '') {
            rest.metadata = null
          } else if (typeof metadata === 'string') {
            try {
              rest.metadata = JSON.parse(metadata)
            } catch (error) {
              throw new Error(`Invalid JSON for Metadata: ${toError(error).message}`)
            }
          } else {
            rest.metadata = metadata
          }
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'AgentPhone API key' },
    country: { type: 'string', description: 'Country code (US or CA)' },
    areaCode: { type: 'string', description: 'Preferred area code (US/CA only)' },
    attachAgentId: { type: 'string', description: 'Agent ID to attach on number provisioning' },
    numberId: { type: 'string', description: 'Phone number ID' },
    callAgentId: { type: 'string', description: 'Agent ID to place the call from' },
    toNumberCall: { type: 'string', description: 'Destination phone number for the call' },
    fromNumberId: { type: 'string', description: 'Phone number ID to use as caller ID' },
    initialGreeting: { type: 'string', description: 'Optional initial greeting' },
    voice: { type: 'string', description: 'Voice override' },
    systemPrompt: { type: 'string', description: 'System prompt for built-in LLM' },
    callId: { type: 'string', description: 'Call ID' },
    callsStatus: { type: 'string', description: 'Filter calls by status' },
    callsDirection: { type: 'string', description: 'Filter calls by direction' },
    callsType: { type: 'string', description: 'Filter calls by type (pstn or web)' },
    callsSearch: { type: 'string', description: 'Search calls by phone number' },
    conversationId: { type: 'string', description: 'Conversation ID' },
    messageLimit: { type: 'string', description: 'Number of messages to include' },
    metadata: { type: 'string', description: 'JSON metadata object to store on conversation' },
    sendAgentId: { type: 'string', description: 'Agent ID sending the message' },
    toNumberMessage: { type: 'string', description: 'Recipient phone number' },
    messageBody: { type: 'string', description: 'Message body' },
    mediaUrl: { type: 'string', description: 'Media URL to attach' },
    sendNumberId: { type: 'string', description: 'Phone number ID to send from' },
    messageId: { type: 'string', description: 'Message ID' },
    reaction: { type: 'string', description: 'Reaction type' },
    contactPhoneNumber: { type: 'string', description: 'Contact phone number' },
    contactName: { type: 'string', description: 'Contact name' },
    contactEmail: { type: 'string', description: 'Contact email' },
    contactNotes: { type: 'string', description: 'Contact notes' },
    contactId: { type: 'string', description: 'Contact ID' },
    contactsSearch: { type: 'string', description: 'Contact search filter' },
    limit: { type: 'string', description: 'Pagination limit' },
    offset: { type: 'string', description: 'Pagination offset' },
    messagesLimit: { type: 'string', description: 'Messages pagination limit' },
    before: { type: 'string', description: 'Cursor: ISO 8601 upper bound' },
    after: { type: 'string', description: 'Cursor: ISO 8601 lower bound' },
    usageDays: { type: 'string', description: 'Number of days for daily usage' },
    usageMonths: { type: 'string', description: 'Number of months for monthly usage' },
  },

  outputs: {
    id: { type: 'string', description: 'ID of the primary resource returned' },
    phoneNumber: { type: 'string', description: 'Phone number in E.164 format' },
    country: { type: 'string', description: 'Country code' },
    status: { type: 'string', description: 'Status field (varies by operation)' },
    type: { type: 'string', description: 'Resource type (e.g. sms)' },
    agentId: { type: 'string', description: 'Agent ID associated with the resource' },
    phoneNumberId: { type: 'string', description: 'Phone number ID' },
    fromNumber: { type: 'string', description: 'Originating phone number' },
    toNumber: { type: 'string', description: 'Destination phone number' },
    direction: { type: 'string', description: 'inbound or outbound' },
    startedAt: { type: 'string', description: 'ISO 8601 start timestamp' },
    endedAt: { type: 'string', description: 'ISO 8601 end timestamp' },
    durationSeconds: { type: 'number', description: 'Call duration in seconds' },
    lastTranscriptSnippet: { type: 'string', description: 'Last transcript snippet' },
    recordingUrl: { type: 'string', description: 'Recording audio URL' },
    recordingAvailable: { type: 'boolean', description: 'Whether a recording is available' },
    transcripts: {
      type: 'json',
      description:
        'Ordered transcript turns on call detail: [{id, transcript, confidence, response, createdAt}]',
    },
    transcript: {
      type: 'json',
      description: 'Flat transcript entries from the transcript endpoint: [{role, content}]',
    },
    callId: { type: 'string', description: 'Call ID' },
    channel: { type: 'string', description: 'Message channel: sms, mms, or imessage' },
    from_: { type: 'string', description: 'Sender phone number on a number message' },
    body: { type: 'string', description: 'Message body text' },
    mediaUrl: { type: 'string', description: 'Attached media URL' },
    receivedAt: { type: 'string', description: 'ISO 8601 timestamp' },
    participant: { type: 'string', description: 'External participant phone number' },
    lastMessageAt: { type: 'string', description: 'ISO 8601 timestamp' },
    lastMessagePreview: {
      type: 'string',
      description: 'Last message preview (list_conversations only)',
    },
    messageCount: { type: 'number', description: 'Number of messages in a conversation' },
    metadata: { type: 'json', description: 'Custom metadata stored on a conversation' },
    messages: {
      type: 'json',
      description:
        'Conversation messages: [{id, body, fromNumber, toNumber, direction, channel, mediaUrl, receivedAt}]',
    },
    reactionType: { type: 'string', description: 'Reaction type applied' },
    messageId: { type: 'string', description: 'Message ID' },
    name: { type: 'string', description: 'Contact name' },
    email: { type: 'string', description: 'Contact email' },
    notes: { type: 'string', description: 'Contact notes' },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    updatedAt: { type: 'string', description: 'ISO 8601 update timestamp' },
    data: {
      type: 'json',
      description: 'Array of items returned by list operations (shape varies by operation)',
    },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    total: { type: 'number', description: 'Total number of matching items' },
    released: { type: 'boolean', description: 'Whether a phone number was released' },
    deleted: { type: 'boolean', description: 'Whether a contact was deleted' },
    plan: {
      type: 'json',
      description:
        'Usage plan (name, limits: numbers/messagesPerMonth/voiceMinutesPerMonth/maxCallDurationMinutes/concurrentCalls)',
    },
    numbers: {
      type: 'json',
      description: 'Number usage breakdown (used, limit, remaining)',
    },
    stats: {
      type: 'json',
      description:
        'Usage stats: totalMessages/messagesLast{24h,7d,30d}, totalCalls/callsLast{24h,7d,30d}, webhook delivery counts',
    },
    periodStart: { type: 'string', description: 'Usage period start' },
    periodEnd: { type: 'string', description: 'Usage period end' },
    days: { type: 'number', description: 'Days returned for daily usage' },
    months: { type: 'number', description: 'Months returned for monthly usage' },
  },
}
