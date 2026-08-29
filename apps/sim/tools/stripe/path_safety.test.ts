/**
 * @vitest-environment node
 *
 * Guards every Stripe tool against path traversal through an LLM-writable id
 * that gets interpolated into the request path.
 *
 * These ids are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../v1/customers/victim` escape the
 * resource it addresses once `fetch` normalized the URL, re-aiming the request
 * — and the workspace's live Stripe **secret key** — at an arbitrary Stripe
 * object, including on the DELETE tools. That makes this money-moving surface,
 * not merely a data-read one.
 *
 * Wrapping the id in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 */
import { describe, expect, it } from 'vitest'
import { stripeDeleteCustomerTool } from '@/tools/stripe/delete_customer'
import { stripeDeleteInvoiceTool } from '@/tools/stripe/delete_invoice'
import { stripeDeleteProductTool } from '@/tools/stripe/delete_product'
import * as stripeTools from '@/tools/stripe/index'
import { stripeUpdateSubscriptionTool } from '@/tools/stripe/update_subscription'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../v1/customers/victim',
  '..%2f..%2fv1/customers/victim',
  'cus_abc/../../../v1/charges',
  'cus_abc?expand[]=sources',
  'cus_abc#fragment',
  'cus_abc/subscriptions/../../../v1/payouts',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  'cus_ABC123',
  'ch_ABC123',
  'ch_3PqRsTuVwXyZaBcD1EfGhIjK',
  'sub_1PqRsTuVwXyZaBcD',
  'in_1PqRsTuVwXyZaBcD',
  'pi_3PqRsTuVwXyZaBcD0AbCdEfG',
  'price_1PqRsTuVwXyZaBcD',
  'prod_QmNoPqRsTuVwXy',
  'evt_1PqRsTuVwXyZaBcD',
  'txn_1PqRsTuVwXyZaBcD',
] as const

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isStripeTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('stripe_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'sk_test_token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = value
    }
  }
  return params
}

function buildUrl(tool: AnyTool, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, value) as any))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(stripeTools)
  .filter(isStripeTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildUrl(tool, SAFE_ID).pathname.includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('stripe path-id traversal safety', () => {
  it('covers every Stripe tool that interpolates an id into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(25)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildUrl(tool, SAFE_ID).pathname)

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.stripe.com')
      expect(url.pathname.startsWith('/v1/')).toBe(true)

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? value : segment)
      })
    })
  })
})

const HIGH_RISK_TOOLS: ReadonlyArray<{ name: string; tool: AnyTool }> = [
  { name: 'stripe_delete_customer', tool: stripeDeleteCustomerTool },
  { name: 'stripe_delete_invoice', tool: stripeDeleteInvoiceTool },
  { name: 'stripe_delete_product', tool: stripeDeleteProductTool },
  { name: 'stripe_update_subscription', tool: stripeUpdateSubscriptionTool },
]

describe.each(HIGH_RISK_TOOLS)('$name id path safety', ({ tool }) => {
  it('rejects a bare dot-dot segment instead of silently popping the resource', () => {
    expect(() => buildUrl(tool, '..')).toThrow(/id/)
  })

  it('rejects a bare dot segment', () => {
    expect(() => buildUrl(tool, '.')).toThrow(/id/)
  })

  it('does not let the id inject query parameters', () => {
    const url = buildUrl(tool, 'cus_abc?expand[]=sources')

    expect(url.searchParams.get('expand[]')).toBeNull()
  })

  it('preserves a legitimate id verbatim after trimming', () => {
    expect(buildUrl(tool, '  cus_ABC123  ').pathname).toContain('/cus_ABC123')
  })
})
