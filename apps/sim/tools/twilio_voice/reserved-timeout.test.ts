/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TwilioVoiceBlock } from '@/blocks/blocks/twilio_voice'
import { prepareToolRequest } from '@/tools/request-transport'
import { makeCallTool } from '@/tools/twilio_voice/make_call'

describe('Twilio ring timeout is not the transport deadline', () => {
  it('sends ringTimeout as the Twilio Timeout form field in seconds', () => {
    const request = prepareToolRequest(makeCallTool, {
      accountSid: 'AC123',
      authToken: 'token',
      to: '+14155551234',
      from: '+14155559876',
      twiml: '[Response][Say]Hello[/Say][/Response]',
      ringTimeout: 60,
    })

    expect(new URLSearchParams(request.body as string).get('Timeout')).toBe('60')
    expect(request.timeout).toBeUndefined()
  })

  it('declares ringTimeout and no reserved timeout param', () => {
    expect(makeCallTool.params.ringTimeout).toBeDefined()
    expect(makeCallTool.params.timeout).toBeUndefined()
  })

  it('maps the timeout subBlock onto ringTimeout and clears the reserved key', () => {
    const params = TwilioVoiceBlock.tools.config?.params?.({
      operation: 'make_call',
      accountSid: 'AC123',
      authToken: 'token',
      to: '+14155551234',
      from: '+14155559876',
      timeout: '60',
    }) as Record<string, unknown>

    expect(params.ringTimeout).toBe(60)
    expect(Object.hasOwn(params, 'timeout')).toBe(true)
    expect(params.timeout).toBeUndefined()
  })

  it('keeps the timeout subBlock id so saved workflows still resolve', () => {
    expect(TwilioVoiceBlock.subBlocks.some((subBlock) => subBlock.id === 'timeout')).toBe(true)
  })
})
