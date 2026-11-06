import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import {
  buildZohoDeskBody,
  parseZohoDeskJson,
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type { ZohoDeskSendReplyParams, ZohoDeskSendReplyResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_THREAD_PROPERTIES } from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskSendReplyTool: ToolConfig<ZohoDeskSendReplyParams, ZohoDeskSendReplyResponse> =
  {
    id: 'zoho_desk_send_reply',
    name: 'Zoho Desk Send Reply',
    description: 'Send an email reply from a configured Zoho Desk sender address.',
    version: '1.0.0',
    oauth: { required: true, provider: 'zoho-desk' },
    params: {
      ...ZOHO_DESK_AUTH_PARAMS,
      isPrivate: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Specifies whether the thread is Private or Public. Forwarded threads are always private.',
      },
      sendImmediately: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Specify whether the reply has to sent immediately',
      },
      ticketId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Ticket ID',
      },
      replyContent: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Content of the thread',
      },
      replyContentType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Formatting type of the content. Applicable only for the EMAIL channel. Values supported are html and plainText (default).',
      },
      inReplyToThreadId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'ID of the thread to which current thread is a reply, applicable only for EMAIL channel',
      },
      replyDirection: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Key that returns whether the thread is incoming or outgoing',
      },
      cc: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Email ID to be CC-ed. Applicable only for EMAIL channel',
      },
      bcc: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Email ID to be BCC-ed., if any exist. Applicable only for EMAIL channel',
      },
      hasAttach: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'States whether the thread has attachments',
      },
      ticketStatus: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Status of the ticket. Includes the custom statuses configured in your help desk portal.',
      },
      replyAttachmentIds: {
        type: 'array',
        items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
        required: false,
        visibility: 'user-or-llm',
        description:
          'List of attachment IDs, applicable only for EMAIL channel. For information on how to retrieve attachment IDs, refer to the Uploads section. JSON array.',
      },
      to: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'To email ID in the thread, applicable only for EMAIL channel',
      },
      fromEmailAddress: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Sender email address configured in your Zoho Desk portal.',
      },
      isForward: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Key that returns if the thread was sent as a forward. Applicable only for the EMAIL channel.',
      },
    },
    request: {
      url: (params) => {
        const query = new URLSearchParams()
        if (params.isPrivate != null) query.set('isPrivate', String(params.isPrivate))
        if (params.sendImmediately != null)
          query.set('sendImmediately', String(params.sendImmediately))
        return `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'ticketId')}/sendReply${query.size ? `?${query}` : ''}`
      },
      method: 'POST',
      headers: buildZohoDeskHeaders,
      body: (params) => {
        const body = buildZohoDeskBody({
          channel: 'EMAIL',
          content: params.replyContent,
          contentType: params.replyContentType,
          inReplyToThreadId: params.inReplyToThreadId,
          direction: params.replyDirection,
          cc: params.cc,
          bcc: params.bcc,
          hasAttach: params.hasAttach,
          ticketStatus: params.ticketStatus,
          attachmentIds: parseZohoDeskJson(
            params.replyAttachmentIds,
            'replyAttachmentIds',
            'array'
          ),
          to: params.to,
          fromEmailAddress: params.fromEmailAddress,
          isForward: params.isForward,
        })
        return body
      },
    },
    transformResponse: async (response) => {
      const data = await readZohoDeskResponse(response)
      return {
        success: true,
        output: { thread: projectZohoDeskResource(data, ZOHO_DESK_THREAD_PROPERTIES) },
      }
    },
    outputs: {
      thread: {
        type: 'object',
        description: 'The thread',
        properties: ZOHO_DESK_THREAD_PROPERTIES,
      },
    },
  }
