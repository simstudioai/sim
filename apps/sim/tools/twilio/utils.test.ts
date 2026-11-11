import { describe, expect, it } from 'vitest'
import { sendSMSTool } from '@/tools/twilio/send_sms'
import { listCallsTool } from '@/tools/twilio_voice/list_calls'
import { makeCallTool } from '@/tools/twilio_voice/make_call'

const ACCOUNT_SID = `AC${'a'.repeat(32)}`
const AUTH_TOKEN = 'c'.repeat(32)
const API_KEY_PAIR = `SK${'b'.repeat(32)}:key-secret`

function basic(pair: string): string {
  return `Basic ${Buffer.from(pair).toString('base64')}`
}

function urlFor<P>(url: string | ((params: P) => string), params: P): string {
  return typeof url === 'function' ? url(params) : url
}

/** The Authorization header and URL each Twilio request tool builds for one credential value. */
function requestsWith(authToken: string): Array<[string, string, string]> {
  const sms = {
    phoneNumbers: '+15550000001',
    message: 'hello',
    fromNumber: '+15550000000',
    accountSid: ACCOUNT_SID,
    authToken,
  }
  const call = {
    to: '+15550000001',
    from: '+15550000000',
    twiml: '<Response/>',
    accountSid: ACCOUNT_SID,
    authToken,
  }
  const list = { accountSid: ACCOUNT_SID, authToken }
  return [
    [
      'send SMS',
      sendSMSTool.request.headers(sms).Authorization,
      urlFor(sendSMSTool.request.url, sms),
    ],
    [
      'make call',
      makeCallTool.request.headers(call).Authorization,
      urlFor(makeCallTool.request.url, call),
    ],
    [
      'list calls',
      listCallsTool.request.headers(list).Authorization,
      urlFor(listCallsTool.request.url, list),
    ],
  ]
}

describe('Twilio request authorization', () => {
  it.each(requestsWith(AUTH_TOKEN))(
    '%s authenticates an auth token as the account, as before',
    (_, authorization) => {
      expect(authorization).toBe(basic(`${ACCOUNT_SID}:${AUTH_TOKEN}`))
    }
  )

  it.each(requestsWith(API_KEY_PAIR))(
    '%s authenticates an API key as its SID and secret, on the account URL',
    (_, authorization, url) => {
      expect(authorization).toBe(basic(API_KEY_PAIR))
      expect(url).toContain(`/Accounts/${ACCOUNT_SID}/`)
    }
  )
})
