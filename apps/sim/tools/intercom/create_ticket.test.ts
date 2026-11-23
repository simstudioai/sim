import { describe, expect, it } from 'vitest'
import type { IntercomCreateTicketParams } from '@/tools/intercom/create_ticket'
import { intercomCreateTicketTool } from '@/tools/intercom/create_ticket'

describe('Intercom create ticket notifications', () => {
  it('sends the documented skip_notifications field', () => {
    const build = intercomCreateTicketTool.request.body
    if (!build) throw new Error('create ticket must build a body')
    const params: IntercomCreateTicketParams = {
      accessToken: 't',
      ticket_type_id: '1',
      contacts: '[{"id":"c1"}]',
      ticket_attributes: '{"_default_title_":"Help"}',
      disable_notifications: true,
    }
    const body = build(params)
    expect(body).toHaveProperty('skip_notifications', true)
    expect(body).not.toHaveProperty('disable_notifications')
  })
})
