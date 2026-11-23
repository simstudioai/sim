import { describe, expect, it } from 'vitest'
import { zendeskGetTicketTool } from '@/tools/zendesk/get_ticket'

const headersFor = (params: Record<string, unknown>) => {
  const build = zendeskGetTicketTool.request.headers
  if (typeof build !== 'function') throw new Error('Zendesk headers are built per request')
  return build({ subdomain: 'acme', ticketId: '1', ...params } as never)
}

describe('Zendesk request authentication', () => {
  it('signs in with the block’s own email and API token exactly as before', () => {
    expect(headersFor({ email: 'agent@example.com', apiToken: 'inline-token' }).Authorization).toBe(
      `Basic ${Buffer.from('agent@example.com/token:inline-token').toString('base64')}`
    )
  })

  it('sends a saved OAuth client token as a bearer token', () => {
    expect(headersFor({ accessToken: 'bearer-1' }).Authorization).toBe('Bearer bearer-1')
  })

  it('sends a saved API-token credential as the Basic credential it already is', () => {
    expect(headersFor({ accessToken: 'ZW5jb2RlZA==', authStyle: 'basic' }).Authorization).toBe(
      'Basic ZW5jb2RlZA=='
    )
  })

  it('lets a saved credential win over inline secrets left in a block’s state', () => {
    expect(
      headersFor({ email: 'old@example.com', apiToken: 'stale', accessToken: 'bearer-1' })
        .Authorization
    ).toBe('Bearer bearer-1')
  })
})
