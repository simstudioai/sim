import { createLogger } from '@/lib/logs/console/logger'
import type { TwilioHangupCallParams, TwilioHangupOutput } from '@/tools/twilio_voice/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('Twilio Voice Hangup Call Tool')

export const hangupCallTool: ToolConfig<TwilioHangupCallParams, TwilioHangupOutput> = {
  id: 'twilio_voice_hangup_call',
  name: 'Twilio Voice Hangup Call',
  description: 'End an active phone call.',
  version: '1.0.0',

  params: {
    callSid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Call SID of the call to hang up',
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
    body: () => {
      const formData = new URLSearchParams()
      formData.append('Status', 'completed')
      return { body: formData.toString() }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    logger.info('Twilio Hangup Call Response:', data)

    if (data.error_code) {
      return {
        success: false,
        output: {
          success: false,
          error: data.message || data.error_message || 'Failed to hang up call',
        },
        error: data.message || data.error_message || 'Failed to hang up call',
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
    success: { type: 'boolean', description: 'Whether the call was successfully hung up' },
    callSid: { type: 'string', description: 'Unique identifier for the call' },
    status: { type: 'string', description: 'Final call status (should be completed)' },
    error: { type: 'string', description: 'Error message if hangup failed' },
  },
}

