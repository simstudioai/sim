import { createLogger } from '@/lib/logs/console/logger'
import type { TwilioSendTwimlParams, TwilioTwimlOutput } from '@/tools/twilio_voice/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('Twilio Voice Send TwiML Tool')

export const sendTwimlTool: ToolConfig<TwilioSendTwimlParams, TwilioTwimlOutput> = {
  id: 'twilio_voice_send_twiml',
  name: 'Twilio Voice Send TwiML',
  description: 'Update an in-progress call with new TwiML instructions.',
  version: '1.0.0',

  params: {
    callSid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Call SID of the call to update',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL that returns TwiML instructions',
    },
    twiml: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'TwiML instructions to execute (alternative to URL)',
    },
    method: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTP method for URL request (GET or POST)',
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
  },

  request: {
    url: (params) => {
      if (!params.accountSid || !params.callSid) {
        throw new Error('Twilio Account SID and Call SID are required')
      }
      return `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Calls/${params.callSid}.json`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accountSid || !params.authToken) {
        throw new Error('Twilio credentials are required')
      }
      const authToken = Buffer.from(`${params.accountSid}:${params.authToken}`).toString('base64')
      return {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    },
    body: (params) => {
      if (!params.url && !params.twiml) {
        throw new Error('Either URL or TwiML is required')
      }

      const formData = new URLSearchParams()

      // Either URL or TwiML (URL takes precedence)
      if (params.url) {
        formData.append('Url', params.url)
        if (params.method) {
          formData.append('Method', params.method)
        }
      } else if (params.twiml) {
        formData.append('Twiml', params.twiml)
      }

      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    logger.info('Twilio Send TwiML Response:', data)

    if (data.error_code || data.status === 'failed') {
      return {
        success: false,
        output: {
          success: false,
          error: data.message || data.error_message || 'Failed to update call',
        },
        error: data.message || data.error_message || 'Failed to update call',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        callSid: data.sid,
        status: data.status,
      },
      error: undefined,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the TwiML was successfully sent' },
    callSid: { type: 'string', description: 'Unique identifier for the call' },
    status: { type: 'string', description: 'Updated call status' },
    error: { type: 'string', description: 'Error message if update failed' },
  },
}

