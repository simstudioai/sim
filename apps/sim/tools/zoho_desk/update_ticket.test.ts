/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { zohoDeskUpdateTicketTool } from '@/tools/zoho_desk/update_ticket'

describe('zohoDeskUpdateTicketTool request body', () => {
  const base = { accessToken: 'tok', orgId: '700', ticketId: '123' }
  const buildBody = zohoDeskUpdateTicketTool.request.body as (p: Record<string, unknown>) => unknown

  it('throws when no updatable fields are provided', () => {
    expect(() => buildBody(base)).toThrow(/no fields to update/i)
  })

  it('builds a body containing only the provided fields', () => {
    expect(buildBody({ ...base, status: 'Closed' })).toEqual({ status: 'Closed' })
    expect(buildBody({ ...base, priority: 'High', subject: 'Hi' })).toEqual({
      priority: 'High',
      subject: 'Hi',
    })
  })
})
