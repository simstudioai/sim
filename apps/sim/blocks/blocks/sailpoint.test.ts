import { describe, expect, it } from 'vitest'
import { SailPointV2Block } from '@/blocks/blocks/sailpoint'
import type { BlockToolParamsContext } from '@/blocks/types'
import { sailpointSearchTool } from '@/tools/sailpoint/definitions'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = SailPointV2Block.tools.config?.params
  if (!mapper) throw new Error('SailPoint block has no params mapper')
  return mapper(params, context)
}

/** What the canvas executor hands the tool: raw inputs overlaid by the mapper output. */
function canvasToolInput(params: Record<string, unknown>) {
  return { ...params, ...mapParams(params) }
}

/** What a tool call hands the tool: merged row and model args overlaid by the mapper output. */
function toolCallInput(params: Record<string, unknown>, operation: string) {
  return { ...params, ...mapParams(params, { operation }) }
}

describe('SailPoint tool-call mapping', () => {
  it('coerces stored row dropdowns and pagination when the operation arrives only in the context', () => {
    const input = toolCallInput(
      { includeIDNSource: 'false', limit: '25', count: 'true' },
      'sailpoint_list_sources'
    )
    expect(input).toMatchObject({ includeIDNSource: false, limit: 25, count: true })
  })

  it('sends a row approval comment and keeps the model comment when the row has none', () => {
    expect(
      toolCallInput(
        { approvalId: 'a1', approvalComment: 'Looks good' },
        'sailpoint_reject_access_request'
      ).comment
    ).toBe('Looks good')
    expect(
      toolCallInput(
        { approvalId: 'a1', comment: 'From the model' },
        'sailpoint_reject_access_request'
      ).comment
    ).toBe('From the model')
  })

  it('keeps model filter arguments that a canvas selector would gate', () => {
    const input = toolCallInput(
      { id: 'cert', reviewItemFilterType: '', roles: 'r1' },
      'sailpoint_list_certification_review_items'
    )
    expect(input.roles).toBe('r1')
    expect(
      toolCallInput(
        { identityScopeType: '', requestedBy: 'me' },
        'sailpoint_list_account_activities'
      ).requestedBy
    ).toBe('me')
  })
})

describe('SailPoint search list fields', () => {
  it('passes a comma-separated sort through to the tool instead of failing the mapping', () => {
    expect(canvasToolInput({ operation: 'sailpoint_search', sort: 'displayName,-id' }).sort).toBe(
      'displayName,-id'
    )
  })

  it.each([
    [
      'a canvas JSON number',
      canvasToolInput({ operation: 'sailpoint_search', searchAfter: '12345' }),
    ],
    ['a model number', toolCallInput({ searchAfter: 12345 }, 'sailpoint_search')],
  ])('sends a lone searchAfter given as %s as a one-entry string list', (_label, input) => {
    const operationInput = sailpointSearchTool.operation?.input
    if (!operationInput) throw new Error('SailPoint search has no operation input')
    const request = operationInput({
      ...input,
      tenant: 't',
      accessToken: 'token',
      query: { query: '*' },
    })
    expect(request).toMatchObject({ searchAfter: ['12345'] })
  })
})

describe('SailPoint canvas selector gates', () => {
  it('drops a review-item filter left over from a previously selected type', () => {
    const input = canvasToolInput({
      operation: 'sailpoint_list_certification_review_items',
      id: 'cert',
      reviewItemFilterType: 'roles',
      roles: 'r1',
      entitlements: 'e1',
    })
    expect(input.roles).toBe('r1')
    expect(input.entitlements).toBeUndefined()
  })

  it('drops a stale includeUnsegmented once segmentation is turned off', () => {
    const input = canvasToolInput({
      operation: 'sailpoint_list_roles',
      accessModelSegmentationMode: '',
      forSegmentIds: 'seg-1',
      includeUnsegmented: 'false',
    })
    expect(input.forSegmentIds).toBeUndefined()
    expect(input.includeUnsegmented).toBeUndefined()
  })

  it('drops an identity scope that is no longer selected', () => {
    const input = canvasToolInput({
      operation: 'sailpoint_get_access_request_status',
      identityScopeType: 'regardingIdentity',
      regardingIdentity: 'id-2',
      requestedBy: 'id-1',
    })
    expect(input.regardingIdentity).toBe('id-2')
    expect(input.requestedBy).toBeUndefined()
  })

  it('drops a list filter expression left over when switching to a search', () => {
    const input = canvasToolInput({ operation: 'sailpoint_search', filters: 'name eq "x"' })
    expect(input.filters).toBeUndefined()
    expect(
      canvasToolInput({ operation: 'sailpoint_search', searchFilters: '{"a":{}}' }).filters
    ).toEqual({ a: {} })
  })

  it('drops a search cursor left over when switching to list entitlements', () => {
    expect(
      canvasToolInput({ operation: 'sailpoint_list_entitlements', searchAfter: '["a"]' })
        .searchAfter
    ).toBeUndefined()
    expect(
      canvasToolInput({
        operation: 'sailpoint_list_entitlements',
        searchAfter: '["a"]',
        entitlementSearchAfter: 'cursor-1',
      }).searchAfter
    ).toBe('cursor-1')
  })

  it('keeps model filters and searchAfter on tool calls', () => {
    expect(toolCallInput({ filters: '{"a":{}}' }, 'sailpoint_search').filters).toBe('{"a":{}}')
    expect(
      toolCallInput({ searchAfter: 'cursor-2' }, 'sailpoint_list_entitlements').searchAfter
    ).toBe('cursor-2')
  })
})
