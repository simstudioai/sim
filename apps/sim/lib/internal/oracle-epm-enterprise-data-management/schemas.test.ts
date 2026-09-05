/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  edmApplicationSchema,
  edmInputSchemas,
  edmJobResultSchema,
  edmJobSchema,
  edmLinkEnvelopeSchema,
  edmNodeSchema,
  edmRequestSchema,
} from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'

const id = '11111111-1111-4111-8111-111111111111'
const auth = {
  oauthCredential: 'credential',
  accessToken: 'dTpw',
  instanceUrl: 'https://edm.example.com',
}
const base = {
  ...auth,
  applicationName: 'Planning',
  dimensionName: 'Account',
  fileName: 'account.csv',
}

describe('EDM documented contracts and input boundaries', () => {
  it.each([1700000000000, '2026-01-02T03:04:05.000Z'])(
    'accepts documented timestamp representations: %s',
    (created) => {
      expect(edmJobSchema.parse({ id, status: 'COMPLETED', created }).created).toBe(created)
    }
  )
  it('accepts links-only asynchronous responses without inventing entity fields', () => {
    expect(
      edmLinkEnvelopeSchema.parse({
        links: [{ rel: 'results', href: `https://edm.example.com/epm/rest/v1/jobRuns/${id}` }],
      }).links
    ).toHaveLength(1)
  })
  it('preserves opaque job results without interpreting their nested schema', () => {
    const result = { sheets: [{ providerSpecific: ['arbitrary', 12, null] }], futureField: false }
    expect(edmJobResultSchema.parse({ id, status: 'COMPLETED', result }).result).toEqual(result)
  })
  it('projects documented node fields instead of recursive provider extras', () => {
    const node = edmNodeSchema.parse({
      id,
      name: 'Account',
      location: id,
      propertyValues: [{ value: null, displayValue: '' }],
      children: [{ secret: 'not projected' }],
    })
    expect(node.propertyValues[0].value).toBeNull()
    expect(node).not.toHaveProperty('children')
    expect(node.path).toEqual([])
  })
  it('keeps subscription request relationships and excludes sensitive user fields', () => {
    const request = edmRequestSchema.parse({
      id,
      origin: 'SUBSCRIPTION',
      sourceRequest: { id },
      autoSubmitted: false,
      validTransitionActions: ['SUBMIT'],
      createdByUser: { id, userName: 'reviewer', ssoToken: 'secret' },
    })
    expect(request).toMatchObject({
      origin: 'SUBSCRIPTION',
      autoSubmitted: false,
      sourceRequest: { id },
      validTransitionActions: ['SUBMIT'],
    })
    expect(request.createdByUser).not.toHaveProperty('ssoToken')
  })
  it('accepts optional application data without requiring unavailable bindings', () => {
    expect(
      edmApplicationSchema.parse({ id, name: 'Planning', dimensions: [{ id, name: 'Account' }] })
        .dimensions[0].bindings
    ).toEqual([])
  })
  it.each(['import_dimension', 'load_viewpoint'] as const)(
    'requires an explicit mode for %s',
    (action) => {
      const fields = {
        ...base,
        viewName: 'Enterprise',
        viewpointName: 'Accounts',
        purpose: 'Approved changes',
        operation: `oracle_epm_edm_${action}`,
      }
      expect(edmInputSchemas[action].safeParse(fields).success).toBe(false)
    }
  )
  it('preserves explicitly false workflow options', () => {
    const parsed = edmInputSchemas.transition_request.parse({
      ...auth,
      operation: 'oracle_epm_edm_transition_request',
      requestId: id,
      action: 'SUBMIT',
      transitionWithWarning: false,
      waitForCompletion: false,
    })
    expect(parsed.transitionWithWarning).toBe(false)
    expect(parsed.waitForCompletion).toBe(false)
  })
  it.each([
    { lastDays: 91 },
    { fromDate: 1 },
    { fromDate: 1, toDate: 90 * 86400 + 2 },
    { fromDate: 20, toDate: 1 },
    { fromDate: 1, toDate: 2, lastDays: 1 },
    { owner: 'one,two' },
    { requestType: 'Interactive,Subscription' },
  ])('rejects ambiguous or oversized request windows and filters: %j', (input) => {
    expect(
      edmInputSchemas.query_requests.safeParse({
        ...auth,
        operation: 'oracle_epm_edm_query_requests',
        ...input,
      }).success
    ).toBe(false)
  })
  it('accepts a 90-day epoch-second window without a relative default', () => {
    const parsed = edmInputSchemas.query_requests.parse({
      ...auth,
      operation: 'oracle_epm_edm_query_requests',
      fromDate: 1700000000,
      toDate: 1700000000 + 90 * 86400,
    })
    expect(parsed.lastDays).toBeUndefined()
  })
  it.each([{}, { since: 1, sinceLastExportOfType: 'FULL' }])(
    'requires exactly one incremental-export boundary: %j',
    (boundary) => {
      expect(
        edmInputSchemas.incremental_export_dimension.safeParse({
          ...base,
          operation: 'oracle_epm_edm_incremental_export_dimension',
          bindingNames: ['Account'],
          nodeChangeTypes: ['NEW'],
          ...boundary,
        }).success
      ).toBe(false)
    }
  )
  it('rejects unbounded traversal before provider work', () => {
    expect(
      edmInputSchemas.browse_hierarchy.safeParse({
        ...auth,
        operation: 'oracle_epm_edm_browse_hierarchy',
        viewId: id,
        viewpointId: id,
        maxDepth: 4,
      }).success
    ).toBe(false)
  })
  it.each([
    { scope: 'children' },
    { scope: 'request' },
    { scope: 'top', parentNodeId: id },
    { fromId: id, toId: id },
  ])('rejects inconsistent node scope: %j', (input) => {
    expect(
      edmInputSchemas.list_nodes.safeParse({
        ...auth,
        operation: 'oracle_epm_edm_list_nodes',
        viewId: id,
        viewpointId: id,
        ...input,
      }).success
    ).toBe(false)
  })
  it.each(['../account.csv', 'a/b.csv', 'a\\b.csv', 'a\r\nInjected: yes'])(
    'rejects a non-file staging name: %s',
    (fileName) => {
      expect(
        edmInputSchemas.export_dimension.safeParse({
          ...base,
          operation: 'oracle_epm_edm_export_dimension',
          fileName,
        }).success
      ).toBe(false)
    }
  )
})
