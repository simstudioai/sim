import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { TwilioSMSBlockOutput, TwilioSendSMSParams } from './types'

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
      description: 'Phone numbers to send the message to, separated by newlines'
    },
    message: {
      type: 'string',
      required: true,
      description: 'Message to send'
    },
    accountSid: {
      type: 'string',
      required: true,
      description: 'Twilio Account SID',
      requiredForToolCall: true
    },
    authToken: {
      type: 'string',
      required: true,
      description: 'Twilio Auth Token',
      requiredForToolCall: true
    },
    fromNumber: {
      type: 'string',
      required: true,
      description: 'Twilio phone number to send the message from'
    }
  },

  request: {
    url: (params) => {
      if (!params.accountSid) {
        throw new Error('Twilio Account SID is required')
      }
      const url = `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Messages.json`
      logger.info('Request URL:', url)
      return url
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accountSid || !params.authToken) {
        throw new Error('Twilio credentials are required')
      }
      // Use Buffer instead of btoa for Node.js compatibility
      const authToken = btoa(`${params.accountSid}:${params.authToken}`)
      const headers = {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
      logger.info('Request Headers:', { ...headers, Authorization: 'Basic [REDACTED]' }) // Redact the actual token for security
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

      logger.info('fromNumber', params.fromNumber)
      logger.info('toNumber', toNumber)
      logger.info('message', params.message)
    

      const body_data = new URLSearchParams()
      body_data.append('To', toNumber)
      body_data.append('From', params.fromNumber)
      body_data.append('Body', params.message)

      
      logger.info('Request Body:', body_data.toString())
      return body_data.toString()
    }
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data.error?.message || data.message || `Failed to send SMS (HTTP ${response.status})`
      logger.error('Twilio API error:', data)
      throw new Error(errorMessage)
    }
    
    logger.info('Twilio Response:', data)

    return {
      success: true,
      output: {
        success: true,
        messageId: data.sid,
        status: data.status
      },
      error: undefined
    }
  },

  transformError: (error) => {
    logger.error('Twilio tool error:', { error })
    return `SMS sending failed: ${error.message || 'Unknown error occurred'}`
  }
}