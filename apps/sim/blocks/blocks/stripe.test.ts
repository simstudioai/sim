/**
 * The executor hands a tool `{ ...rawInputs, ...blockParams }`, so a Stripe field the mapper
 * leaves unassigned reaches the form body raw. On a Stripe update an empty value is not a
 * no-op: it can flip a subscription's cancellation, archive a price, or mark an invoice paid.
 */
import { describe, expect, it } from 'vitest'
import { StripeBlock } from '@/blocks/blocks/stripe'
import type { BlockConfig } from '@/blocks/types'
import { stripeListChargesTool } from '@/tools/stripe/list_charges'
import { stripePayInvoiceTool } from '@/tools/stripe/pay_invoice'
import { stripeRetrieveCustomerTool } from '@/tools/stripe/retrieve_customer'
import { stripeUpdateSubscriptionTool } from '@/tools/stripe/update_subscription'
import type { ToolConfig } from '@/tools/types'

function executorParams(block: BlockConfig, inputs: Record<string, unknown>) {
  const mapped = block.tools.config?.params?.(inputs) ?? {}
  return { ...inputs, ...mapped } as Record<string, unknown>
}

/** An agent tool call: no `operation` in the args, the selected one in the context. */
function agentToolParams(
  block: BlockConfig,
  operation: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const mapped = block.tools.config?.params?.(args, { operation }) ?? {}
  return { ...args, ...mapped }
}

function formBody(tool: ToolConfig, params: Record<string, unknown>): URLSearchParams {
  const built = tool.request.body?.(params as never) as { body: string }
  return new URLSearchParams(built.body)
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): URL {
  const url = tool.request.url
  return new URL(typeof url === 'function' ? url(params as never) : url)
}

describe('Stripe block keeps unset fields out of requests', () => {
  it('Default cancel_at_period_end is not sent on a subscription update', () => {
    const params = executorParams(StripeBlock, {
      operation: 'update_subscription',
      apiKey: 'sk_test',
      id: 'sub_1',
      cancel_at_period_end: '',
    })
    expect(formBody(stripeUpdateSubscriptionTool, params).has('cancel_at_period_end')).toBe(false)
  })

  it('a stored Yes or No is still sent unchanged', () => {
    const yes = executorParams(StripeBlock, {
      operation: 'pay_invoice',
      apiKey: 'sk_test',
      id: 'in_1',
      paid_out_of_band: 'true',
    })
    const no = executorParams(StripeBlock, {
      operation: 'update_subscription',
      apiKey: 'sk_test',
      id: 'sub_1',
      cancel_at_period_end: 'false',
    })
    expect(formBody(stripePayInvoiceTool, yes).get('paid_out_of_band')).toBe('true')
    expect(formBody(stripeUpdateSubscriptionTool, no).get('cancel_at_period_end')).toBe('false')
  })

  it('a subscription item id is sent so the item is updated, not duplicated', () => {
    const params = executorParams(StripeBlock, {
      operation: 'update_subscription',
      apiKey: 'sk_test',
      id: 'sub_1',
      items: '[{"id": "si_1", "price": "price_2"}]',
    })
    const body = formBody(stripeUpdateSubscriptionTool, params)
    expect(body.get('items[0][id]')).toBe('si_1')
    expect(body.get('items[0][price]')).toBe('price_2')
  })

  it('list pagination reads its own cursor, not a stale subscription cursor', () => {
    const params = executorParams(StripeBlock, {
      operation: 'list_charges',
      apiKey: 'sk_test',
      starting_after: 'sub_stale',
      list_starting_after: 'ch_9',
    })
    expect(requestUrl(stripeListChargesTool, params).searchParams.get('starting_after')).toBe(
      'ch_9'
    )
  })

  it('a path id cannot traverse to another Stripe endpoint', () => {
    expect(() =>
      requestUrl(stripeRetrieveCustomerTool, { apiKey: 'sk_test', id: '../charges' })
    ).toThrow(/path separator/)
  })

  it('an agent paginates list charges with the cursor it passes', () => {
    const params = agentToolParams(StripeBlock, 'list_charges', {
      apiKey: 'sk_test',
      starting_after: 'ch_9',
    })
    expect(requestUrl(stripeListChargesTool, params).searchParams.get('starting_after')).toBe(
      'ch_9'
    )
  })
})
