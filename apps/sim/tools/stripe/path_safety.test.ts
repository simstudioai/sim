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
 *
 * The unit of coverage is a **(tool, parameter) pair**, not a tool. Fuzzing
 * every parameter of a tool at once and tolerating a throw is unsound: the
 * first guarded parameter throws and silently retires every sibling from the
 * suite, so a tool that already has one guard stops testing the rest. Each
 * case below fuzzes exactly one parameter while holding its siblings at a safe
 * value, which is what makes "a newly added unguarded path parameter fails CI"
 * actually true. A throw is only accepted as a pass *because* the thrown-at
 * parameter is the one under test.
 */
import { describe, expect, it } from 'vitest'
import { stripeDeleteCustomerTool } from '@/tools/stripe/delete_customer'
import { stripeDeleteInvoiceTool } from '@/tools/stripe/delete_invoice'
import { stripeDeleteProductTool } from '@/tools/stripe/delete_product'
import * as stripeTools from '@/tools/stripe/index'
import { stripeUpdateSubscriptionTool } from '@/tools/stripe/update_subscription'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_VALUES = [
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

/** The value the parameter under test carries when a path is being mapped. */
const TARGET = 'TARGETVALUE'

/** The value every *other* string parameter is pinned to while one is fuzzed. */
const SIBLING = 'SIBLINGVALUE'

type PathTool = ToolConfig<Record<string, unknown>, ToolResponse>

/** Parameters that carry credentials or the host, never a path segment. */
const FIXED_PARAMS: Record<string, unknown> = { apiKey: 'sk_test_token' }

function isStripeTool(value: unknown): value is PathTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.startsWith('stripe_')
  )
}

/**
 * Narrows one concretely-typed tool export to the structural shape this
 * harness drives.
 *
 * A direct assignment cannot work and must not be forced with a cast: under
 * `strictFunctionTypes` a `ToolConfig<ConcreteParams, R>` is not assignable to
 * `ToolConfig<Record<string, unknown>, ToolResponse>`, because `request.url`
 * accepts the parameter type contravariantly. Re-checking the value at runtime
 * through the same guard is what makes the narrowing sound rather than
 * asserted.
 */
function asPathTool(value: unknown): PathTool {
  if (!isStripeTool(value)) {
    throw new Error('expected a Stripe tool')
  }
  return value
}

/** The placeholder a sibling parameter holds, chosen so the URL still builds. */
function siblingValue(type: string | undefined): unknown {
  if (type === 'json' || type === 'array') return []
  if (type === 'number') return 1
  if (type === 'boolean') return false
  return SIBLING
}

/**
 * Builds a param object with exactly one parameter under test.
 *
 * Every sibling is pinned to a safe placeholder, so a failure can only be
 * attributed to `target`. This is the whole difference from a fill-everything
 * sweep, where the first parameter to throw hides all the others.
 */
function buildParams(tool: PathTool, target: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { ...FIXED_PARAMS }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name in FIXED_PARAMS) continue
    params[name] = name === target ? value : siblingValue((def as { type?: string }).type)
  }
  return params
}

function buildUrl(tool: PathTool, target: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, target, value)))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

/** True when `target` actually lands in the path rather than the query string. */
function reachesPath(tool: PathTool, target: string): boolean {
  try {
    return buildUrl(tool, target, TARGET).pathname.includes(TARGET)
  } catch {
    return false
  }
}

interface PathParamCase {
  name: string
  param: string
  tool: PathTool
}

/**
 * Typed as `unknown[]` on purpose: the barrel's values are a union of
 * concretely-typed `ToolConfig`s, and `Array.prototype.filter`'s type-predicate
 * overload requires the predicate's type to extend the array's. Widening to
 * `unknown` first is what lets the guard below do the narrowing.
 */
const ALL_EXPORTS: unknown[] = Object.values(stripeTools)

const PATH_PARAM_CASES: PathParamCase[] = ALL_EXPORTS.filter(isStripeTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
      .filter((param) => !(param in FIXED_PARAMS))
      .filter((param) => reachesPath(tool, param))
      .map((param) => ({ name: `${tool.id} / ${param}`, param, tool }))
  )

describe('stripe path-parameter traversal safety', () => {
  it('covers every (stripe tool, path parameter) pair', () => {
    expect(PATH_PARAM_CASES.length).toBeGreaterThanOrEqual(25)
  })

  describe.each(PATH_PARAM_CASES)('$name', ({ tool, param }) => {
    const baseline = segmentsOf(buildUrl(tool, param, TARGET).pathname)

    it.each(TRAVERSAL_VALUES)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, param, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.stripe.com')
      expect(url.pathname.startsWith('/v1/')).toBe(true)

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === TARGET) return
        expect(actual[index]).toBe(segment)
      })
    })

    /**
     * The shape check above cannot see a bare dot in the *final* segment: `x/.`
     * normalizes to `x/`, which keeps the segment count and leaves every other
     * segment intact. Rejection is the only observable difference, so assert it
     * directly for every parameter rather than only the hand-picked ones below.
     */
    it.each(['.', '..'])('rejects the bare %j segment', (value) => {
      expect(() => buildUrl(tool, param, value)).toThrow(/path traversal/)
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, param, value).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === TARGET ? value : segment)
      })
    })
  })
})

const HIGH_RISK_CASES: ReadonlyArray<{ name: string; tool: PathTool; param: string }> = [
  { name: 'stripe_delete_customer', tool: asPathTool(stripeDeleteCustomerTool), param: 'id' },
  { name: 'stripe_delete_invoice', tool: asPathTool(stripeDeleteInvoiceTool), param: 'id' },
  { name: 'stripe_delete_product', tool: asPathTool(stripeDeleteProductTool), param: 'id' },
  {
    name: 'stripe_update_subscription',
    tool: asPathTool(stripeUpdateSubscriptionTool),
    param: 'id',
  },
]

describe.each(HIGH_RISK_CASES)('$name path safety', ({ tool, param }) => {
  it('rejects a bare dot-dot segment instead of silently popping the resource', () => {
    expect(() => buildUrl(tool, param, '..')).toThrow(/path traversal/)
  })

  it('rejects a bare dot segment', () => {
    expect(() => buildUrl(tool, param, '.')).toThrow(/path traversal/)
  })

  it('does not let the value inject query parameters', () => {
    const url = buildUrl(tool, param, 'cus_abc?expand[]=sources')

    expect(url.searchParams.get('expand[]')).toBeNull()
  })

  it('preserves a legitimate value verbatim after trimming', () => {
    expect(buildUrl(tool, param, '  cus_ABC123  ').pathname).toContain(`/${'cus_ABC123'}`)
  })
})
