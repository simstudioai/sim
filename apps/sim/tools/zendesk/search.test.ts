import { describe, expect, it } from 'vitest'
import { zendeskSearchTool } from '@/tools/zendesk/search'

const sentQuery = (query: string) => {
  const build = zendeskSearchTool.request.url
  if (typeof build !== 'function') throw new Error('Zendesk search URL is built per request')
  const url = build({
    subdomain: 'acme',
    email: 'agent@example.com',
    apiToken: 'token',
    query,
    filterType: 'ticket',
  })
  return new URL(url).searchParams.get('query')
}

describe('Zendesk search export query', () => {
  it('drops a standalone type filter, which the export endpoint rejects', () => {
    expect(sentQuery('type:ticket status:open')).toBe('status:open')
    expect(sentQuery('-type:user status:open')).toBe('status:open')
  })

  it('keeps type: text inside a quoted phrase', () => {
    expect(sentQuery('subject:"unexpected type:widget" status:open')).toBe(
      'subject:"unexpected type:widget" status:open'
    )
  })

  it('keeps the ticket_type keyword', () => {
    expect(sentQuery('ticket_type:incident')).toBe('ticket_type:incident')
  })
})
