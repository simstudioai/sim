/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { prepareToolRequest } from '@/tools/request-transport'
import { stripeCreateSubscriptionTool } from '@/tools/stripe/create_subscription'
import { stripeUpdateSubscriptionTool } from '@/tools/stripe/update_subscription'

function subscriptionRequest(
  operation: 'create_subscription' | 'update_subscription',
  items: string
) {
  const mapParams = StripeBlock.tools.config?.params
  if (!mapParams) throw new Error('Stripe block parameter mapper is missing')
  const params = mapParams({
    operation,
    apiKey: 'sk_test_example',
    id: 'sub_example',
    customer: 'cus_example',
    items,
  })
  const tool =
    operation === 'create_subscription'
      ? stripeCreateSubscriptionTool
      : stripeUpdateSubscriptionTool
  return prepareToolRequest(tool, {
    ...params,
    _context: { executionId: 'run_example', blockId: 'block_example', invocationId: '0' },
  })
}

describe('Stripe subscription item mutations', () => {
  it('preserves the item identity when changing an existing subscription price', () => {
    const request = subscriptionRequest(
      'update_subscription',
      '[{"id":"si_existing","price":"price_replacement","quantity":2}]'
    )

    expect(request.url).toBe('https://api.stripe.com/v1/subscriptions/sub_example')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      'items[0][id]': 'si_existing',
      'items[0][price]': 'price_replacement',
      'items[0][quantity]': '2',
    })
  })

  it.each(['create_subscription', 'update_subscription'] as const)(
    'preserves an explicit zero quantity in %s',
    (operation) => {
      const request = subscriptionRequest(operation, '[{"price":"price_example","quantity":0}]')
      const body = new URLSearchParams(request.body)

      expect(body.get('items[0][quantity]')).toBe('0')
      expect(body.get('items[0][price]')).toBe('price_example')
    }
  )

  it('keeps adding new items without an existing item ID or an explicit quantity', () => {
    const request = subscriptionRequest('update_subscription', '[{"price":"price_new"}]')

    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      'items[0][price]': 'price_new',
    })
  })
})

describe.each([stripeCreateSubscriptionTool, stripeUpdateSubscriptionTool])(
  'Stripe direct $id item quantities',
  (tool) => {
    it.each([undefined, null, '', 0, 2])('preserves the requested quantity (%s)', (quantity) => {
      const request = prepareToolRequest(tool, {
        apiKey: 'sk_test_example',
        id: 'sub_example',
        customer: 'cus_example',
        items: [{ price: 'price_example', quantity }],
        _context: { executionId: 'run_example', blockId: 'block_example', invocationId: '0' },
      })

      expect(new URLSearchParams(request.body).get('items[0][quantity]')).toBe(
        typeof quantity === 'number' ? String(quantity) : null
      )
    })
  }
)
