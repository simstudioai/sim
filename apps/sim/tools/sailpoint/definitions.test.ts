import { describe, expect, it } from 'vitest'
import {
  sailpointDecideCertificationReviewItemsTool,
  sailpointGetAccountSelectionsTool,
  sailpointListEntitlementsTool,
  sailpointRequestAccessTool,
  sailpointSearchAggregateTool,
  sailpointSearchTool,
} from '@/tools/sailpoint/definitions'
import type { SailPointSearchAggregateParams, SailPointSearchParams } from '@/tools/sailpoint/types'

const credentials = { clientId: 'client', clientSecret: 'secret', tenant: 'tenant' }

function operationInput(params: SailPointSearchAggregateParams) {
  return sailpointSearchAggregateTool.operation.input(params)
}

describe('SailPoint Search Aggregate tool input', () => {
  it.each([
    ['aggregationsDsl', {}],
    ['aggregationsDsl', '{}'],
    ['aggregations', {}],
    ['aggregations', '{}'],
  ] as const)('rejects an empty %s definition', (field, value) => {
    expect(() => operationInput({ ...credentials, [field]: value })).toThrow(
      'aggregationsDsl or aggregations must be a non-empty object'
    )
  })

  it('accepts either non-empty aggregation representation', () => {
    expect(
      operationInput({ ...credentials, aggregationsDsl: { names: { terms: { field: 'name' } } } })
    ).toMatchObject({ aggregationsDsl: { names: { terms: { field: 'name' } } } })
    expect(
      operationInput({ ...credentials, aggregations: { names: { type: 'TERM', field: 'name' } } })
    ).toMatchObject({ aggregations: { names: { type: 'TERM', field: 'name' } } })
  })
})

describe('SailPoint exact input contracts', () => {
  it('advertises the Search service limit of 10,000', () => {
    expect(sailpointSearchTool.params.limit.description).toContain('10,000')
    expect(() =>
      sailpointSearchTool.operation.input({
        ...credentials,
        query: { query: 'name:a*' },
        limit: 10_000,
      } as SailPointSearchParams)
    ).not.toThrow()
  })

  it('allows additive identity and segment entitlement filters', () => {
    expect(() =>
      sailpointListEntitlementsTool.operation.input({
        ...credentials,
        segmentedForIdentity: 'identity',
        forSegmentIds: 'segment-a,segment-b',
      })
    ).not.toThrow()
  })

  it('rejects proposedEndDate for an approve decision', () => {
    expect(() =>
      sailpointDecideCertificationReviewItemsTool.operation.input({
        ...credentials,
        id: 'certification',
        decisions: [
          {
            id: 'review-item',
            decision: 'APPROVE',
            bulk: false,
            proposedEndDate: '2026-09-01T00:00:00.000Z',
          },
        ],
      })
    ).toThrow('proposedEndDate is only allowed for REVOKE')
  })

  it('rejects multiple entitlement items in a nested machine revoke', () => {
    expect(() =>
      sailpointRequestAccessTool.operation.input({
        ...credentials,
        requestType: 'REVOKE_ACCESS',
        requestedForWithRequestedItems: [
          {
            identityId: 'machine',
            identityType: 'MACHINE',
            requestedItems: [
              { type: 'ENTITLEMENT', id: 'one', comment: 'remove', nativeIdentity: 'account' },
              { type: 'ENTITLEMENT', id: 'two', comment: 'remove', nativeIdentity: 'account' },
            ],
          },
        ],
      })
    ).toThrow('REVOKE_ACCESS allows at most one entitlement item')
  })

  it('allows SailPoint to auto-resolve a machine revoke account when nativeIdentity is omitted', () => {
    expect(
      sailpointRequestAccessTool.operation.input({
        ...credentials,
        requestType: 'REVOKE_ACCESS',
        requestedForWithRequestedItems: [
          {
            identityId: 'machine',
            identityType: 'MACHINE',
            requestedItems: [{ type: 'ENTITLEMENT', id: 'entitlement', comment: 'remove' }],
          },
        ],
      })
    ).toMatchObject({
      requestedForWithRequestedItems: [
        {
          requestedItems: [{ type: 'ENTITLEMENT', id: 'entitlement', comment: 'remove' }],
        },
      ],
    })
  })

  it('supports account-selection discovery without a preselected account', () => {
    expect(
      sailpointGetAccountSelectionsTool.operation.input({
        ...credentials,
        requestedForWithRequestedItems: [
          {
            identityId: 'machine',
            identityType: 'MACHINE',
            requestedItems: [{ type: 'ENTITLEMENT', id: 'entitlement' }],
          },
        ],
      })
    ).toMatchObject({
      operation: 'sailpoint_get_account_selections',
      requestedForWithRequestedItems: [
        {
          identityId: 'machine',
          identityType: 'MACHINE',
          requestedItems: [{ type: 'ENTITLEMENT', id: 'entitlement' }],
        },
      ],
    })
  })
})
