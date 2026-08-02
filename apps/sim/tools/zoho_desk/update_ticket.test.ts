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

  // The workflow serializer initializes every untouched subBlock to `null` (not
  // `undefined`) and writes those nulls into tool params, so this - not the
  // fields-absent case above - is the shape the block actually produces. A
  // status-only edit must not post `subject: null` and blank the ticket.
  it('drops untouched fields that arrive as null from the serializer', () => {
    const serializedParams = {
      ...base,
      subject: null,
      status: 'Closed',
      priority: null,
      assigneeId: null,
      departmentId: null,
      category: null,
      subCategory: null,
      dueDate: null,
      description: null,
      resolution: null,
      classification: null,
      customFields: null,
    }
    expect(buildBody(serializedParams)).toEqual({ status: 'Closed' })
  })

  it('drops fields the user cleared to an empty string', () => {
    expect(buildBody({ ...base, status: 'Closed', subject: '' })).toEqual({ status: 'Closed' })
  })

  // The empty-PATCH guard must be reachable from the real serializer shape, not
  // only from the synthetic fields-absent case.
  it('throws when every updatable field is null', () => {
    expect(() => buildBody({ ...base, subject: null, status: null, priority: null })).toThrow(
      /no fields to update/i
    )
  })
})
