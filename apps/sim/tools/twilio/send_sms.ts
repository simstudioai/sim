import { TWILIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { TwilioSendSMSParams, TwilioSMSBlockOutput } from '@/tools/twilio/types'
import { twilioAuthorization } from '@/tools/twilio/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const sendSMSTool: ToolConfig<TwilioSendSMSParams, TwilioSMSBlockOutput> = {
  id: 'twilio_send_sms',
  name: 'Twilio Send SMS',
  description:
    'Send a text message to one recipient using the Twilio API. Call once per recipient to reach several numbers.',
  version: '1.0.0',
  oauth: TWILIO_CREDENTIAL_OAUTH,

  params: {
    phoneNumbers: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Recipient phone number in E.164 format (e.g., +15551234567) or a channel address (e.g., whatsapp:+15551234567). Only the first line is used.',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message to send',
    },
    accountSid: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Twilio Account SID',
    },
    authToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Twilio Auth Token, or an API key as SKxxx:secret',
    },
    fromNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sender: a Twilio phone number in E.164 format (e.g., +15551234567), alphanumeric sender ID, short code, or channel address. Required unless a Messaging Service SID is given.',
    },
    messagingServiceSid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Messaging Service SID (MG...). When set without a From number, Twilio picks the sender from the service sender pool.',
    },
  },

  request: {
    url: (params) => {
      if (!params.accountSid) {
        throw new Error('Twilio Account SID is required')
      }
      return `https://api.twilio.com/2010-04-01/Accounts/${safeUrlPathSegment(params.accountSid, 'accountSid')}/Messages.json`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accountSid || !params.authToken) {
        throw new Error('Twilio credentials are required')
      }
      return {
        Authorization: twilioAuthorization(params.accountSid.trim(), params.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params) => {
      if (!params.phoneNumbers) {
        throw new Error('Phone numbers are required but not provided')
      }
      if (!params.message) {
        throw new Error('Message content is required but not provided')
      }
      const fromNumber = params.fromNumber?.trim()
      const messagingServiceSid = params.messagingServiceSid?.trim()
      if (!fromNumber && !messagingServiceSid) {
        throw new Error('From number is required but not provided')
      }

      // Twilio's `To` takes one recipient per message, so only the first line is sent.
      const toNumber = params.phoneNumbers.split('\n')[0].trim()

      const formData = new URLSearchParams()
      formData.append('To', toNumber)
      if (fromNumber) {
        formData.append('From', fromNumber)
      }
      if (messagingServiceSid) {
        formData.append('MessagingServiceSid', messagingServiceSid)
      }
      formData.append('Body', params.message)

      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        success: true,
        messageId: data.sid,
        status: data.status,
        fromNumber: data.from ?? null,
        toNumber: data.to ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'SMS send success status' },
    messageId: { type: 'string', description: 'Unique Twilio message identifier (SID)' },
    status: { type: 'string', description: 'Message delivery status from Twilio' },
    fromNumber: {
      type: 'string',
      description: 'Phone number message was sent from',
      nullable: true,
    },
    toNumber: { type: 'string', description: 'Phone number message was sent to', nullable: true },
  },
}
