import { Twilio } from 'twilio'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SMSService')

export interface SMSOptions {
  to: string | string[]
  body: string
  from?: string
}

export interface BatchSMSOptions {
  messages: SMSOptions[]
}

export interface SMSResponseData {
  sid?: string
  status?: string
  to?: string
  from?: string
  id?: string
  results?: SendSMSResult[]
  count?: number
}

export interface SendSMSResult {
  success: boolean
  message: string
  data?: SMSResponseData
}

export interface BatchSendSMSResult {
  success: boolean
  message: string
  results: SendSMSResult[]
  data?: SMSResponseData
}

const twilioAccountSid = env.TWILIO_ACCOUNT_SID
const twilioAuthToken = env.TWILIO_AUTH_TOKEN
const twilioPhoneNumber = env.TWILIO_PHONE_NUMBER

const twilioClient =
  twilioAccountSid &&
  twilioAuthToken &&
  twilioAccountSid.trim() !== '' &&
  twilioAuthToken.trim() !== ''
    ? new Twilio(twilioAccountSid, twilioAuthToken)
    : null

export async function sendSMS(options: SMSOptions): Promise<SendSMSResult> {
  try {
    const { to, body, from } = options
    const fromNumber = from || twilioPhoneNumber

    if (!fromNumber || fromNumber.trim() === '') {
      logger.error('No Twilio phone number configured')
      return {
        success: false,
        message: 'SMS sending failed: No from phone number configured',
      }
    }

    if (!twilioClient) {
      logger.error('SMS sending failed: Twilio not configured', {
        to,
        body: `${body.substring(0, 50)}...`,
        from: fromNumber,
      })
      return {
        success: false,
        message:
          'SMS sending failed: Twilio credentials not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in your environment variables.',
      }
    }

    if (typeof to === 'string') {
      return await sendSingleSMS(to, body, fromNumber)
    }

    const results: SendSMSResult[] = []
    for (const phoneNumber of to) {
      try {
        const result = await sendSingleSMS(phoneNumber, body, fromNumber)
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to send SMS',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    return {
      success: successCount === results.length,
      message:
        successCount === results.length
          ? 'All SMS messages sent successfully'
          : `${successCount}/${results.length} SMS messages sent successfully`,
      data: { results, count: successCount },
    }
  } catch (error) {
    logger.error('Error sending SMS:', error)
    return {
      success: false,
      message: 'Failed to send SMS',
    }
  }
}

async function sendSingleSMS(to: string, body: string, from: string): Promise<SendSMSResult> {
  if (!twilioClient) {
    throw new Error('Twilio client not configured')
  }

  try {
    const message = await twilioClient.messages.create({
      body,
      from,
      to,
    })

    logger.info('SMS sent successfully:', {
      to,
      from,
      messageSid: message.sid,
      status: message.status,
    })

    return {
      success: true,
      message: 'SMS sent successfully via Twilio',
      data: {
        sid: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
      },
    }
  } catch (error) {
    logger.error('Failed to send SMS via Twilio:', error)
    throw error
  }
}

export async function sendBatchSMS(options: BatchSMSOptions): Promise<BatchSendSMSResult> {
  try {
    const results: SendSMSResult[] = []

    logger.info('Sending batch SMS messages')
    for (const smsOptions of options.messages) {
      try {
        const result = await sendSMS(smsOptions)
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to send SMS',
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    return {
      success: successCount === results.length,
      message:
        successCount === results.length
          ? 'All batch SMS messages sent successfully'
          : `${successCount}/${results.length} SMS messages sent successfully`,
      results,
      data: { count: successCount },
    }
  } catch (error) {
    logger.error('Error in batch SMS sending:', error)
    return {
      success: false,
      message: 'Failed to send batch SMS messages',
      results: [],
    }
  }
}
