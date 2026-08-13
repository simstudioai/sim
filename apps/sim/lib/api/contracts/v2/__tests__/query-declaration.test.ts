/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type SweptContractEntry,
  sweepV2Contracts,
} from '@/lib/api/contracts/v2/__tests__/contract-sweep'
import { rejectsUnknownKeys } from '@/lib/api/contracts/v2/__tests__/schema-introspection'

/**
 * Every v2 contract must declare a `query` schema, and it must be `.strict()`.
 *
 * `parseRequest` validates the query slice only when the contract declares one
 * (`contract.query ? validate : skip`). A contract with no `query` therefore
 * never validates the query string at all: `GET /api/v2/workflows/{id}?bogus=1`
 * answered 200 while every v2 list answered 400 for the same shape. The caller
 * learns nothing about the param the server ignored, which is the failure the
 * lists' `.strict()` rule already exists to prevent — a request the server did
 * not honour must not come back 200.
 *
 * The endpoints that take no query say so with `noInputSchema`
 * (`z.object({}).strict()`) rather than by omission, because omission and "takes
 * nothing" were indistinguishable — which is exactly how 69 of them ended up
 * unvalidated without anyone deciding they should be.
 *
 * This sweep is the enforcement, not the 69-contract edit that accompanied it. A
 * one-time edit leaves number 70 free to regress; walking the tree means a new
 * contract fails here the moment it is written, and names itself in the failure.
 *
 * A compile-time gate on `defineRouteContract` was tried first and rejected:
 * making `query` conditionally required on a `/api/v2/` path turns the parameter
 * into an intersection, and the intersection collapses inference of `TParams`,
 * `TBody`, and `THeaders` to `undefined`, breaking every OpenAPI document that
 * reads them back off the contract. The sweep is also the wider net — it sees
 * every contract in the tree, including any a type on that one function would
 * never be asked about.
 */

const SWEEP_TIMEOUT_MS = 60_000

let contractsPromise: Promise<SweptContractEntry[]> | null = null
function loadContracts(): Promise<SweptContractEntry[]> {
  contractsPromise ??= sweepV2Contracts()
  return contractsPromise
}

describe('v2 query declaration', () => {
  it(
    'declares a query schema on every contract, so no v2 endpoint skips query validation',
    async () => {
      const contracts = await loadContracts()
      expect(contracts.length).toBeGreaterThan(100)

      const undeclared = contracts
        .filter((entry) => !entry.contract.query)
        .map((entry) => `${entry.key} (${entry.name})`)

      expect(
        undeclared,
        'A v2 contract without a `query` schema accepts any query param silently: parseRequest skips the slice entirely when the contract declares none. Use `noInputSchema` from @/lib/api/contracts/primitives when the endpoint takes no query params. See .agents/skills/v2-api-conventions/SKILL.md.'
      ).toEqual([])
    },
    SWEEP_TIMEOUT_MS
  )

  it('makes every declared v2 query reject a param it does not implement', async () => {
    const contracts = await loadContracts()

    const nonStrict = contracts
      .filter((entry) => entry.contract.query && rejectsUnknownKeys(entry.contract.query) !== true)
      .map((entry) => `${entry.key} (${entry.name})`)

    expect(
      nonStrict,
      'Zod strips unknown keys by default, so a non-strict query answers 200 for a request the server did not honour. Declare the query object `.strict()`. A `null` from the walk means the schema could not be introspected, which must fail rather than pass silently.'
    ).toEqual([])
  })

  /**
   * The endpoints that take no query must accept a bare request and reject a
   * decorated one. Both halves matter: a schema that rejected the empty query
   * would break every existing caller, and one that accepted an unknown key
   * would be the omission this rule replaced, just spelled out.
   */
  it('lets an endpoint that takes no query accept none and refuse an invented one', async () => {
    const contracts = await loadContracts()
    const takesNoQuery = contracts.filter(
      (entry) => entry.contract.query?.safeParse({}).success === true
    )

    expect(takesNoQuery.length).toBeGreaterThan(0)
    for (const entry of takesNoQuery) {
      expect(
        entry.contract.query?.safeParse({ bogus: '1' }).success,
        `${entry.key} accepts an undeclared query param instead of rejecting it`
      ).toBe(false)
    }
  })
})
