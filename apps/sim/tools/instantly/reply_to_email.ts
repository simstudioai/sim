import type { InstantlyEmailResponse, InstantlyReplyToEmailParams } from '@/tools/instantly/types'
import {
  compactBody,
  emailOutputs,
  instantlyBaseParamFields,
  instantlyHeaders,
  instantlyUrl,
  mapEmail,
  parseInstantlyResponse,
} from '@/tools/instantly/utils'
import type { ToolConfig } from '@/tools/types'

export const replyToEmailTool: ToolConfig<InstantlyReplyToEmailParams, InstantlyEmailResponse> = {
  id: 'instantly_reply_to_email',
  name: 'Instantly Reply To Email',
  description: 'Sends an Instantly V2 reply to an existing Unibox email.',
  version: '1.0.0',
  params: {
    ...instantlyBaseParamFields,
    eaccount: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Connected email account used to send the reply',
    },
    reply_to_uuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email ID to reply to',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reply subject',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reply body object with text and/or html',
    },
    cc_address_email_list: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated CC email addresses',
    },
    bcc_address_email_list: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated BCC email addresses',
    },
  },
  request: {
    url: () => instantlyUrl('/api/v2/emails/reply'),
    method: 'POST',
    headers: instantlyHeaders,
    body: (params) =>
      compactBody({
        eaccount: params.eaccount,
        reply_to_uuid: params.reply_to_uuid,
        subject: params.subject,
        body: params.body,
        cc_address_email_list: params.cc_address_email_list,
        bcc_address_email_list: params.bcc_address_email_list,
      }),
  },
  transformResponse: async (response) => {
    const data = await parseInstantlyResponse(response)
    const email = mapEmail(data)

    return {
      success: true,
      output: {
        email,
        id: email.id,
        subject: email.subject,
        thread_id: email.thread_id,
      },
    }
  },
  outputs: emailOutputs,
}
