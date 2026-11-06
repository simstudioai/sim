import { toStringOrNull } from '@sim/utils/coerce'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutCreateConversationParams,
  HelpScoutCreateConversationResponse,
} from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  HELPSCOUT_API_BASE,
  parseHelpScoutId,
  parseOptionalHelpScoutId,
  readResourceId,
  toStringList,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

const CONVERSATION_TYPES = new Set(['email', 'chat', 'phone'])
const CONVERSATION_STATUSES = new Set(['active', 'pending', 'closed'])
const THREAD_TYPES = new Set(['customer', 'reply', 'note'])

function buildCustomer(params: HelpScoutCreateConversationParams): Record<string, unknown> {
  const customerId = parseOptionalHelpScoutId(params.customerId, 'customerId')
  if (customerId !== undefined) return { id: customerId }
  const email = params.customerEmail?.trim()
  if (!email) throw new Error('Provide a customer ID or customer email')
  return {
    email,
    ...(params.customerFirstName?.trim() ? { firstName: params.customerFirstName.trim() } : {}),
    ...(params.customerLastName?.trim() ? { lastName: params.customerLastName.trim() } : {}),
  }
}

export const helpScoutCreateConversationTool: ToolConfig<
  HelpScoutCreateConversationParams,
  HelpScoutCreateConversationResponse
> = {
  id: 'helpscout_create_conversation',
  name: 'Help Scout Create Conversation',
  description:
    'Create a Help Scout conversation in an inbox with a first customer message, reply, or note. A new customer is created when the email is not already known.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conversation subject',
    },
    mailboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the inbox to create the conversation in',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'email, chat, or phone (defaults to email)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'active, pending, or closed (defaults to active)',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing customer ID; takes precedence over the customer email',
    },
    customerEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer email, used when no customer ID is given',
    },
    customerFirstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name, used only when a new customer is created',
    },
    customerLastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name, used only when a new customer is created',
    },
    threadType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'customer (a message from the customer), reply (a reply to the customer), or note (defaults to customer)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text of the first thread',
    },
    assignTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User or team ID to assign; omit to follow the inbox settings',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags to add',
    },
    autoReply: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send the inbox auto reply; only valid when threadType is customer',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user creating the conversation; defaults to the connected user',
    },
  },
  request: {
    url: `${HELPSCOUT_API_BASE}/conversations`,
    method: 'POST',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => {
      const type = params.type?.trim() || 'email'
      const status = params.status?.trim() || 'active'
      const threadType = params.threadType?.trim() || 'customer'
      if (!CONVERSATION_TYPES.has(type)) throw new Error('type must be email, chat, or phone')
      if (!CONVERSATION_STATUSES.has(status)) {
        throw new Error('status must be active, pending, or closed')
      }
      if (!THREAD_TYPES.has(threadType)) {
        throw new Error('threadType must be customer, reply, or note')
      }
      if (params.autoReply && threadType !== 'customer') {
        throw new Error('autoReply requires the first thread to be a customer thread')
      }
      const customer = buildCustomer(params)
      const tags = toStringList(params.tags)
      const assignTo = parseOptionalHelpScoutId(params.assignTo, 'assignTo')
      const userId = parseOptionalHelpScoutId(params.userId, 'userId')
      return {
        subject: params.subject,
        mailboxId: parseHelpScoutId(params.mailboxId, 'mailboxId'),
        type,
        status,
        customer,
        threads: [
          {
            type: threadType,
            text: params.text,
            ...(threadType === 'note' ? {} : { customer }),
          },
        ],
        ...(tags.length > 0 ? { tags } : {}),
        ...(assignTo !== undefined ? { assignTo } : {}),
        ...(params.autoReply !== undefined ? { autoReply: params.autoReply } : {}),
        ...(userId !== undefined ? { user: userId } : {}),
      }
    },
  },
  transformResponse: async (response) => ({
    success: true,
    output: {
      id: readResourceId(response),
      webUrl: toStringOrNull(response.headers.get('web-location')),
    },
  }),
  outputs: {
    id: { type: 'number', description: 'ID of the new conversation', nullable: true },
    webUrl: {
      type: 'string',
      description: 'Link to the new conversation in Help Scout',
      nullable: true,
    },
  },
}
