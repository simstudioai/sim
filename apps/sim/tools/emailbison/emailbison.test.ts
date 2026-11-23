import { describe, expect, it } from 'vitest'
import { listLeadsTool } from '@/tools/emailbison/list_leads'
import { listRepliesTool } from '@/tools/emailbison/list_replies'

type UrlBuilder = (params: Record<string, unknown>) => string

function query(tool: { request: { url: unknown } }, params: Record<string, unknown>) {
  const url = (tool.request.url as UrlBuilder)({
    apiKey: 'key',
    apiBaseUrl: 'https://mail.example.com',
    ...params,
  })
  return new URL(url).searchParams
}

describe('Email Bison list filters use Laravel query syntax', () => {
  it('nests List Leads filters under filters[...] with array brackets', () => {
    const params = query(listLeadsTool, {
      campaignStatus: 'replied',
      tagIds: [11, 12],
      withoutTags: false,
    })

    expect(params.get('filters[lead_campaign_status]')).toBe('replied')
    expect(params.getAll('filters[tag_ids][]')).toEqual(['11', '12'])
    expect(params.has('filters[without_tags]')).toBe(false)
  })

  it('sends the without-tags filter as 1 only when it is on', () => {
    expect(query(listLeadsTool, { withoutTags: true }).get('filters[without_tags]')).toBe('1')
  })

  it('sends every List Replies tag ID and the read flag as 1', () => {
    const params = query(listRepliesTool, { tagIds: [1, 2], read: true })

    expect(params.getAll('tag_ids[]')).toEqual(['1', '2'])
    expect(params.get('read')).toBe('1')
  })
})
