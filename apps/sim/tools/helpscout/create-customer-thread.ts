import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutCreateCustomerThreadParams,
  HelpScoutCreateThreadResponse,
} from '@/tools/helpscout/types'
import { CREATED_THREAD_OUTPUTS } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  CONVERSATION_ID_PARAM,
  conversationUrl,
  parseHelpScoutId,
  parseOptionalHelpScoutId,
  readResourceId,
  toStringList,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutCreateCustomerThreadTool: ToolConfig<
  HelpScoutCreateCustomerThreadParams,
  HelpScoutCreateThreadResponse
> = {
  id: 'helpscout_create_customer_thread',
  name: 'Help Scout Add Customer Message',
  description:
    'Add a message from the customer to an existing Help Scout conversation, for example one received on another channel. This reopens the conversation.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the customer sending the message; takes precedence over the email',
    },
    customerEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email of the customer sending the message, used when no customer ID is given',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated CC email addresses',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated BCC email addresses',
    },
  },
  request: {
    url: (params) => conversationUrl(params.conversationId, '/customer'),
    method: 'POST',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => {
      if (!params.text?.trim()) throw new Error('text is required')
      const customerId = parseOptionalHelpScoutId(params.customerId, 'customerId')
      const email = params.customerEmail?.trim()
      if (customerId === undefined && !email) {
        throw new Error('Provide a customer ID or customer email')
      }
      const cc = toStringList(params.cc)
      const bcc = toStringList(params.bcc)
      return {
        customer: customerId !== undefined ? { id: customerId } : { email },
        text: params.text,
        ...(cc.length > 0 ? { cc } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
      }
    },
  },
  transformResponse: async (response, params) => ({
    success: true,
    output: {
      conversationId: params ? parseHelpScoutId(params.conversationId, 'conversationId') : null,
      threadId: readResourceId(response),
    },
  }),
  outputs: CREATED_THREAD_OUTPUTS,
}
