import { createLogger } from '@/lib/logs/console/logger'
import type { TwilioSendSMSParams, TwilioSMSBlockOutput } from '@/tools/twilio/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('Twilio Send SMS Tool')

export const sendSMSTool: ToolConfig<TwilioSendSMSParams, TwilioSMSBlockOutput> = {
  id: 'twilio_send_sms',
  name: 'Twilio Send SMS',
  description: 'Send text messages to single or multiple recipients using the Twilio API.',
  version: '1.0.0',

  params: {
    phoneNumbers: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Phone numbers to send the message to, separated by newlines',
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
      description: 'Twilio Auth Token',
    },
    fromNumber: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Twilio phone number to send the message from',
    },
  },

  request: {
    url: (params) => {
      if (!params.accountSid) {
        throw new Error('Twilio Account SID is required')
      }
      const url = `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Messages.json`
      return url
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accountSid || !params.authToken) {
        throw new Error('Twilio credentials are required')
      }
      // Use Buffer instead of btoa for Node.js compatibility
      const authToken = Buffer.from(`${params.accountSid}:${params.authToken}`).toString('base64')
      const headers = {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
      return headers
    },
    body: (params) => {
      if (!params.phoneNumbers) {
        throw new Error('Phone numbers are required but not provided')
      }
      if (!params.message) {
        throw new Error('Message content is required but not provided')
      }
      if (!params.fromNumber) {
        throw new Error('From number is required but not provided')
      }

      // Get first phone number if multiple are provided
      const toNumber = params.phoneNumbers.split('\n')[0].trim()

      // Create a URLSearchParams object and convert to string
      const formData = new URLSearchParams()
      formData.append('To', toNumber)
      formData.append('From', params.fromNumber)
      formData.append('Body', params.message)

      const formDataString = formData.toString()
      return { body: formDataString }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    logger.info('Twilio Response:', data)
    logger.info('Twilio Response type:', typeof data)
    return {
      success: true,
      output: {
        success: true,
        messageId: data.sid,
        status: data.status,
      },
      error: undefined,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'SMS send success status' },
    messageId: { type: 'string', description: 'Unique Twilio message identifier (SID)' },
    status: { type: 'string', description: 'Message delivery status from Twilio' },
    fromNumber: { type: 'string', description: 'Phone number message was sent from' },
    toNumber: { type: 'string', description: 'Phone number message was sent to' },
  },
}
