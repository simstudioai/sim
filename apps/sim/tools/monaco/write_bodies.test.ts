/**
 * Request bodies whose shape decides what Monaco changes: an empty filter group seeds an
 * audience with every contact, and an empty tag list on PATCH clears a record's tags.
 */
import { describe, expect, it } from 'vitest'
import { monacoCreateAudienceTool } from '@/tools/monaco/create_audience'
import { monacoUpdateContactTool } from '@/tools/monaco/update_contact'
import { monacoUpdateOpportunityTool } from '@/tools/monaco/update_opportunity'
import type { ToolConfig } from '@/tools/types'

function requestBody(tool: ToolConfig, params: Record<string, unknown>) {
  const body = tool.request.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no request body`)
  return body({ accessToken: 'mks_test', ...params })
}

const RULE = { field: 'title', condition: 'contains', value: 'VP' }

describe('Monaco create audience filters', () => {
  it.each([
    ['an empty list', []],
    ['an empty expression', { operator: 'and', filters: [] }],
    [
      'an empty nested group',
      { operator: 'or', filters: [RULE, { operator: 'and', filters: [] }] },
    ],
  ])('rejects %s, which would match every contact', (_label, filters) => {
    expect(() => requestBody(monacoCreateAudienceTool, { name: 'VPs', filters })).toThrow(/empty/)
  })

  it('sends a non-empty expression unchanged', () => {
    const filters = { operator: 'or', filters: [RULE, { operator: 'and', filters: [RULE] }] }
    expect(requestBody(monacoCreateAudienceTool, { name: 'VPs', filters })).toEqual({
      name: 'VPs',
      filters,
    })
  })
})

describe('Monaco PATCH tags', () => {
  it('sends an empty tag list so update contact can clear every tag', () => {
    expect(requestBody(monacoUpdateContactTool, { contactId: 'c-1', tags: '[]' })).toEqual({
      tags: [],
    })
  })

  it('sends an empty tag list so update opportunity can clear every tag', () => {
    expect(requestBody(monacoUpdateOpportunityTool, { opportunityId: 'o-1', tags: [] })).toEqual({
      tags: [],
    })
  })
})
