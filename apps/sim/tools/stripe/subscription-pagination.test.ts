/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { projectToolOutputs } from '@/lib/catalog/projection/tool'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { StripeBlock } from '@/blocks/blocks/stripe'
import { stripeListSubscriptionsTool } from '@/tools/stripe/list_subscriptions'
import { stripeSearchSubscriptionsTool } from '@/tools/stripe/search_subscriptions'

function listUrl(params: Record<string, unknown>): URL {
  const mapParams = StripeBlock.tools.config?.params
  const buildUrl = stripeListSubscriptionsTool.request.url
  if (!mapParams || typeof buildUrl !== 'function') throw new Error('Stripe list mapper is missing')
  const mapped = mapParams({ operation: 'list_subscriptions', apiKey: 'test-secret', ...params })
  return new URL(buildUrl({ ...mapped, apiKey: 'test-secret' }))
}

function searchUrl(params: Record<string, unknown>): URL {
  const mapParams = StripeBlock.tools.config?.params
  const buildUrl = stripeSearchSubscriptionsTool.request.url
  if (!mapParams || typeof buildUrl !== 'function')
    throw new Error('Stripe search mapper is missing')
  const mapped = mapParams({ operation: 'search_subscriptions', apiKey: 'test-secret', ...params })
  return new URL(buildUrl({ ...mapped, apiKey: 'test-secret', query: "status:'active'" }))
}

describe('Stripe subscription pagination', () => {
  it('keeps first-page list filters and sends no cursor', () => {
    const url = listUrl({
      limit: 100,
      customer: 'cus_example',
      status: 'active',
      price: 'price_example',
    })
    expect(url.origin + url.pathname).toBe('https://api.stripe.com/v1/subscriptions')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '100',
      customer: 'cus_example',
      status: 'active',
      price: 'price_example',
    })
  })

  it.each(['starting_after', 'ending_before'] as const)(
    'passes the %s cursor from block to provider URL',
    (cursor) => {
      const url = listUrl({ [cursor]: 'sub_cursor/with+reserved=characters' })
      expect(url.searchParams.get(cursor)).toBe('sub_cursor/with+reserved=characters')
      expect(stripeListSubscriptionsTool.params[cursor]).toMatchObject({
        required: false,
        visibility: 'user-or-llm',
        type: 'string',
      })
    }
  )

  it('rejects conflicting list cursor directions before transport', () => {
    expect(() => listUrl({ starting_after: 'sub_last', ending_before: 'sub_first' })).toThrow(
      'Provide either starting_after or ending_before, not both'
    )
  })

  it('retains the current page count and has_more without claiming a total', async () => {
    const result = await stripeListSubscriptionsTool.transformResponse!(
      Response.json({
        object: 'list',
        data: [{ id: 'sub_first' }, { id: 'sub_last' }],
        has_more: true,
      })
    )
    expect(result.output.metadata).toEqual({ count: 2, has_more: true })
    expect(
      listUrl({ starting_after: result.output.subscriptions.at(-1)?.id }).searchParams.get(
        'starting_after'
      )
    ).toBe('sub_last')
  })

  it('round-trips the opaque next_page token and returns null at the end of search results', async () => {
    const firstUrl = searchUrl({ limit: 100 })
    expect(firstUrl.origin + firstUrl.pathname).toBe(
      'https://api.stripe.com/v1/subscriptions/search'
    )
    expect(Object.fromEntries(firstUrl.searchParams)).toEqual({
      query: "status:'active'",
      limit: '100',
    })

    const first = await stripeSearchSubscriptionsTool.transformResponse!(
      Response.json({
        object: 'search_result',
        data: [{ id: 'sub_match' }],
        has_more: true,
        next_page: 'opaque/search+cursor==',
      })
    )
    expect(first.output.metadata).toEqual({
      count: 1,
      has_more: true,
      next_page: 'opaque/search+cursor==',
    })
    expect(
      searchUrl({ page: first.output.metadata.next_page, limit: 100 }).searchParams.get('page')
    ).toBe('opaque/search+cursor==')

    const last = await stripeSearchSubscriptionsTool.transformResponse!(
      Response.json({
        object: 'search_result',
        data: [],
        has_more: false,
      })
    )
    expect(last.output.metadata).toEqual({ count: 0, has_more: false, next_page: null })
    expect(stripeSearchSubscriptionsTool.params.page).toMatchObject({
      required: false,
      visibility: 'user-or-llm',
    })
    expect(projectToolOutputs(stripeSearchSubscriptionsTool.outputs)).toMatchObject({
      metadata: { properties: { next_page: { type: 'string', nullable: true } } },
    })
  })

  it.each([
    ['starting_after', 'list_subscriptions'],
    ['ending_before', 'list_subscriptions'],
    ['page', 'search_subscriptions'],
  ])('exposes %s only for %s in advanced block inputs', (id, operation) => {
    const field = StripeBlock.subBlocks.find((candidate) => candidate.id === id)
    if (!field) throw new Error(`Missing Stripe cursor field ${id}`)
    expect(field.mode).toBe('advanced')
    expect(evaluateSubBlockCondition(field.condition, { operation })).toBe(true)
    expect(evaluateSubBlockCondition(field.condition, { operation: 'list_customers' })).toBe(false)
    expect(StripeBlock.inputs?.[id]).toMatchObject({ type: 'string' })
  })
})
