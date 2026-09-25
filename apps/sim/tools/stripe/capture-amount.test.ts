import { describe, expect, it } from 'vitest'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { prepareToolRequest } from '@/tools/request-transport'
import { stripeCaptureChargeTool } from '@/tools/stripe/capture_charge'
import { stripeCapturePaymentIntentTool } from '@/tools/stripe/capture_payment_intent'
import { stripeCreatePaymentIntentTool } from '@/tools/stripe/create_payment_intent'
import { stripeUpdatePaymentIntentTool } from '@/tools/stripe/update_payment_intent'
import type { ToolConfig } from '@/tools/types'

function requestBody(tool: ToolConfig, inputs: Record<string, unknown>): URLSearchParams {
  const mapParams = StripeBlock.tools.config?.params
  if (!mapParams) throw new Error('Stripe block parameter mapper is missing')
  const params = mapParams({
    operation: tool.id.slice('stripe_'.length),
    apiKey: 'sk_test_example',
    id: 'resource_example',
    currency: 'usd',
    ...inputs,
  })
  const request = prepareToolRequest(tool, {
    ...params,
    _context: { executionId: 'run_example', blockId: 'block_example', invocationId: '0' },
  })
  return new URLSearchParams(request.body)
}

describe('Stripe partial capture amounts', () => {
  it.each([50, '50'])('forwards the basic Payment Intent amount %s', (amount) => {
    expect(requestBody(stripeCapturePaymentIntentTool, { amount }).get('amount_to_capture')).toBe(
      '50'
    )
  })

  it('prefers an explicit advanced amount over the basic amount', () => {
    expect(
      requestBody(stripeCapturePaymentIntentTool, { amount: '50', amount_to_capture: '25' }).get(
        'amount_to_capture'
      )
    ).toBe('25')
  })

  it.each([undefined, null, '', ' '])('falls back from an unset advanced amount (%s)', (value) => {
    expect(
      requestBody(stripeCapturePaymentIntentTool, { amount: '50', amount_to_capture: value }).get(
        'amount_to_capture'
      )
    ).toBe('50')
  })

  it.each([undefined, null, '', ' '])(
    'keeps full capture optional when both fields are unset (%s)',
    (value) => {
      expect(
        requestBody(stripeCapturePaymentIntentTool, {
          amount: value,
          amount_to_capture: value,
        }).has('amount_to_capture')
      ).toBe(false)
    }
  )

  it.each([undefined, null, '', ' '])('omits an unset charge capture amount (%s)', (amount) => {
    expect(requestBody(stripeCaptureChargeTool, { amount }).has('amount')).toBe(false)
  })

  it.each([
    [stripeCapturePaymentIntentTool, { amount: 0 }, 'amount_to_capture'],
    [stripeCapturePaymentIntentTool, { amount: 50, amount_to_capture: 0 }, 'amount_to_capture'],
    [stripeCaptureChargeTool, { amount: 0 }, 'amount'],
  ] as const)(
    'forwards an explicit zero to %s instead of requesting full capture',
    (tool, inputs, field) => {
      expect(requestBody(tool, inputs).get(field)).toBe('0')
    }
  )

  it.each([stripeCreatePaymentIntentTool, stripeUpdatePaymentIntentTool])(
    'preserves the amount parameter for $id',
    (tool) => {
      const body = requestBody(tool, { amount: '50' })
      expect(body.get('amount')).toBe('50')
      expect(body.has('amount_to_capture')).toBe(false)
    }
  )
})

describe.each([
  [stripeCapturePaymentIntentTool, 'amount_to_capture'],
  [stripeCaptureChargeTool, 'amount'],
] as const)('Stripe direct $0.id capture', (tool, field) => {
  it.each([undefined, null, '', 0, 50])('preserves the requested amount (%s)', (value) => {
    const request = prepareToolRequest(tool, {
      apiKey: 'sk_test_example',
      id: 'resource_example',
      [field]: value,
      _context: { executionId: 'run_example', blockId: 'block_example', invocationId: '0' },
    })

    expect(new URLSearchParams(request.body).get(field)).toBe(
      typeof value === 'number' ? String(value) : null
    )
  })
})
