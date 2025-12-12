import { createLogger } from '@/lib/logs/console/logger'
import { convertSquareBracketsToTwiML } from '@/lib/webhooks/utils'
import type { TwilioCallOutput, TwilioMakeCallParams } from '@/tools/twilio_voice/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('TwilioVoiceMakeCallTool')

export const makeCallTool: ToolConfig<TwilioMakeCallParams, TwilioCallOutput> = {
  id: 'twilio_voice_make_call',
  name: 'Twilio Voice Make Call',
  description: 'Make an outbound phone call using Twilio Voice API.',
  version: '1.0.0',

  params: {
    to: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Phone number to call (E.164 format, e.g., +14155551234)',
    },
    from: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Twilio phone number to call from (E.164 format)',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL that returns TwiML instructions for the call',
    },
    twiml: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'TwiML instructions to execute (alternative to URL). Use square brackets instead of angle brackets, e.g., [Response][Say]Hello[/Say][/Response]',
    },
    statusCallback: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Webhook URL for call status updates',
    },
    statusCallbackMethod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTP method for status callback (GET or POST)',
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
    record: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to record the call',
    },
    recordingStatusCallback: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Webhook URL for recording status updates',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Time to wait for answer before giving up (seconds, default: 60)',
    },
    machineDetection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Answering machine detection: Enable or DetectMessageEnd',
    },
  },

  request: {
    url: (params) => {
      if (!params.accountSid) {
        throw new Error('Twilio Account SID is required')
      }
      if (!params.accountSid.startsWith('AC')) {
        throw new Error(
          `Invalid Account SID format. Account SID must start with "AC" (you provided: ${params.accountSid.substring(0, 2)}...)`
        )
      }
      return `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Calls.json`
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
    body: ((params) => {
      if (!params.to) {
        throw new Error('Destination phone number (to) is required')
      }
      if (!params.from) {
        throw new Error('Source phone number (from) is required')
      }
      if (!params.url && !params.twiml) {
        throw new Error('Either URL or TwiML is required to execute the call')
      }

      logger.info('Make call params:', {
        to: params.to,
        from: params.from,
        record: params.record,
        recordType: typeof params.record,
      })

      const formData = new URLSearchParams()
      formData.append('To', params.to)
      formData.append('From', params.from)

      if (params.url) {
        formData.append('Url', params.url)
      } else if (params.twiml) {
        const convertedTwiml = convertSquareBracketsToTwiML(params.twiml) || params.twiml
        formData.append('Twiml', convertedTwiml)
      }

      if (params.statusCallback) {
        formData.append('StatusCallback', params.statusCallback)
      }
      if (params.statusCallbackMethod) {
        formData.append('StatusCallbackMethod', params.statusCallbackMethod)
      }

      if (params.record === true) {
        logger.info('Enabling call recording')
        formData.append('Record', 'true')
      }

      if (params.recordingStatusCallback) {
        formData.append('RecordingStatusCallback', params.recordingStatusCallback)
      }
      if (params.timeout) {
        formData.append('Timeout', Number(params.timeout).toString())
      }
      if (params.machineDetection) {
        formData.append('MachineDetection', params.machineDetection)
      }

      const bodyString = formData.toString()
      logger.info('Final Twilio request body:', bodyString)

      return bodyString as any
    }) as (params: TwilioMakeCallParams) => Record<string, any>,
  },

  transformResponse: async (response) => {
    const data = await response.json()

    logger.info('Twilio Make Call Response:', data)

    if (data.error_code || data.status === 'failed') {
      return {
        success: false,
        output: {
          success: false,
          error: data.message || data.error_message || 'Call failed',
        },
        error: data.message || data.error_message || 'Call failed',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        callSid: data.sid,
        status: data.status,
        direction: data.direction,
        from: data.from,
        to: data.to,
        duration: data.duration,
        price: data.price,
        priceUnit: data.price_unit,
      },
      error: undefined,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the call was successfully initiated' },
    callSid: { type: 'string', description: 'Unique identifier for the call' },
    status: {
      type: 'string',
      description: 'Call status (queued, ringing, in-progress, completed, etc.)',
    },
    direction: { type: 'string', description: 'Call direction (outbound-api)' },
    from: { type: 'string', description: 'Phone number the call is from' },
    to: { type: 'string', description: 'Phone number the call is to' },
    duration: { type: 'number', description: 'Call duration in seconds' },
    price: { type: 'string', description: 'Cost of the call' },
    priceUnit: { type: 'string', description: 'Currency of the price' },
    error: { type: 'string', description: 'Error message if call failed' },
  },
}
