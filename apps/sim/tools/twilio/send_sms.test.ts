import { describe, expect, it } from 'vitest'
import { sendSMSTool } from '@/tools/twilio/send_sms'
import type { TwilioSendSMSParams } from '@/tools/twilio/types'

const BASE: TwilioSendSMSParams = {
  phoneNumbers: '+15550000001',
  message: 'hello',
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'c'.repeat(32),
}

function formOf(params: TwilioSendSMSParams): URLSearchParams {
  const built = sendSMSTool.request.body?.(params)
  if (!built || typeof built !== 'object' || !('body' in built)) {
    throw new Error('twilio_send_sms built no form body')
  }
  return new URLSearchParams(String(built.body))
}

describe('twilio_send_sms', () => {
  it('sends through a Messaging Service without a From number', () => {
    const form = formOf({ ...BASE, messagingServiceSid: ` MG${'d'.repeat(32)} ` })

    expect(form.get('MessagingServiceSid')).toBe(`MG${'d'.repeat(32)}`)
    expect(form.has('From')).toBe(false)
    expect(form.get('To')).toBe('+15550000001')
  })

  it('still refuses a send with neither a From number nor a Messaging Service', () => {
    expect(() => formOf(BASE)).toThrow('From number is required')
  })

  it('returns the sender and recipient Twilio reports for the message', async () => {
    const response = new Response(
      JSON.stringify({ sid: 'SM1', status: 'queued', from: '+15550000000', to: '+15550000001' })
    )

    const result = await sendSMSTool.transformResponse?.(response)

    expect(result?.output).toMatchObject({ fromNumber: '+15550000000', toNumber: '+15550000001' })
  })
})
