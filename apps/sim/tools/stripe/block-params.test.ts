import { describe, expect, it } from 'vitest'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { prepareToolRequest } from '@/tools/request-transport'
import { stripeCancelSubscriptionTool } from '@/tools/stripe/cancel_subscription'
import { stripeCreateChargeTool } from '@/tools/stripe/create_charge'
import { stripeCreateCustomerTool } from '@/tools/stripe/create_customer'
import { stripeCreateInvoiceTool } from '@/tools/stripe/create_invoice'
import { stripeCreatePaymentIntentTool } from '@/tools/stripe/create_payment_intent'
import { stripeCreatePriceTool } from '@/tools/stripe/create_price'
import { stripeCreateProductTool } from '@/tools/stripe/create_product'
import { stripeCreateSubscriptionTool } from '@/tools/stripe/create_subscription'
import { stripePayInvoiceTool } from '@/tools/stripe/pay_invoice'
import type { ToolConfig } from '@/tools/types'

function requestBody(tool: ToolConfig, inputs: Record<string, unknown>): URLSearchParams {
  const mapParams = StripeBlock.tools.config?.params
  if (!mapParams) throw new Error('Stripe block parameter mapper is missing')
  const params = mapParams({
    operation: tool.id.slice('stripe_'.length),
    apiKey: 'sk_test_example',
    id: 'resource_example',
    amount: 100,
    currency: 'usd',
    name: 'Example',
    customer: 'cus_example',
    product: 'prod_example',
    ...inputs,
  })
  const request = prepareToolRequest(tool, {
    ...params,
    _context: { executionId: 'run_example', blockId: 'block_example', invocationId: '0' },
  })
  return new URLSearchParams(request.body)
}

describe.each([
  ['cancel_at_period_end', stripeCreateSubscriptionTool],
  ['auto_advance', stripeCreateInvoiceTool],
  ['capture', stripeCreateChargeTool],
  ['active', stripeCreateProductTool],
  ['prorate', stripeCancelSubscriptionTool],
  ['invoice_now', stripeCancelSubscriptionTool],
  ['paid_out_of_band', stripePayInvoiceTool],
] as const)('Stripe %s boolean input', (field, tool) => {
  it.each([true, false, 'true', 'false'])('preserves %s in the provider request', (value) => {
    expect(requestBody(tool, { [field]: value }).get(field)).toBe(String(value))
  })

  it.each([undefined, null, ''])('omits an unset value (%s)', (value) => {
    expect(requestBody(tool, { [field]: value }).has(field)).toBe(false)
  })
})

describe.each([
  {
    field: 'address',
    tool: stripeCreateCustomerTool,
    value: { city: 'Example City' },
    encoded: { 'address[city]': 'Example City' },
  },
  {
    field: 'metadata',
    tool: stripeCreateCustomerTool,
    value: { order_id: 'example' },
    encoded: { 'metadata[order_id]': 'example' },
  },
  {
    field: 'items',
    tool: stripeCreateSubscriptionTool,
    value: [{ price: 'price_example', quantity: 0 }],
    encoded: { 'items[0][price]': 'price_example', 'items[0][quantity]': '0' },
  },
  {
    field: 'images',
    tool: stripeCreateProductTool,
    value: ['https://example.com/product.png'],
    encoded: { 'images[0]': 'https://example.com/product.png' },
  },
  {
    field: 'recurring',
    tool: stripeCreatePriceTool,
    value: { interval: 'month', interval_count: 2 },
    encoded: { 'recurring[interval]': 'month', 'recurring[interval_count]': '2' },
  },
])('Stripe $field JSON input', ({ field, tool, value, encoded }) => {
  it.each(['structured', 'string'])('accepts %s values without changing the payload', (mode) => {
    const input = mode === 'string' ? JSON.stringify(value) : structuredClone(value)
    expect(Object.fromEntries(requestBody(tool, { [field]: input }))).toMatchObject(encoded)
  })

  it('rejects malformed JSON before preparing a provider request', () => {
    expect(() => requestBody(tool, { [field]: '{broken' })).toThrow(/Invalid JSON/)
  })
})

describe('Stripe automatic payment methods', () => {
  it.each([true, false])('sends explicit enabled=%s', (enabled) => {
    const request = prepareToolRequest(stripeCreatePaymentIntentTool, {
      apiKey: 'sk_test_example',
      amount: 100,
      currency: 'usd',
      automatic_payment_methods: { enabled },
      _context: { executionId: 'run_example', blockId: 'block_example', invocationId: '0' },
    })

    expect(new URLSearchParams(request.body).get('automatic_payment_methods[enabled]')).toBe(
      String(enabled)
    )
  })

  it.each([undefined, null, ''])('omits an unset enabled flag (%s)', (enabled) => {
    const request = prepareToolRequest(stripeCreatePaymentIntentTool, {
      apiKey: 'sk_test_example',
      amount: 100,
      currency: 'usd',
      automatic_payment_methods: { enabled },
      _context: { executionId: 'run_example', blockId: 'block_example', invocationId: '0' },
    })

    expect(new URLSearchParams(request.body).has('automatic_payment_methods[enabled]')).toBe(false)
  })
})
