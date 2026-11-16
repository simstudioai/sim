import { describe, expect, it } from 'vitest'
import { IntercomV2Block } from '@/blocks/blocks/intercom'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = IntercomV2Block.tools.config?.params
  if (!mapper) throw new Error('Intercom block has no params mapper')
  return mapper(params, context)
}

describe('Intercom snooze timestamps', () => {
  it('sends a positive whole Unix timestamp as a number', () => {
    expect(
      mapParams({
        operation: 'snooze_conversation',
        conversationId: 'c1',
        admin_id: 'a1',
        snoozed_until: '1767225600',
      }).snoozed_until
    ).toBe(1767225600)
  })

  it.each(['0', '-5', '   ', '1.5', 0])('rejects %j as a snooze time', (snoozedUntil) => {
    expect(() =>
      mapParams({
        operation: 'snooze_conversation',
        conversationId: 'c1',
        admin_id: 'a1',
        snoozed_until: snoozedUntil,
      })
    ).toThrow('positive whole Unix timestamp')
  })
})

describe('Intercom agent operation resolution', () => {
  it('keeps a boolean disable_notifications when the operation arrives only in the context', () => {
    const mapped = mapParams(
      { ticket_type_id: 't1', disable_notifications: true },
      { operation: 'create_ticket' }
    )

    expect(mapped.disable_notifications).toBe(true)
  })
})

describe('Intercom ticket snooze', () => {
  it('validates the model snoozed_until on an update_ticket tool call', () => {
    const mapped = mapParams(
      { ticket_id: 't1', snoozed_until: '1767225600' },
      { operation: 'update_ticket' }
    )
    expect(mapped.snoozed_until).toBe(1767225600)
    expect(() =>
      mapParams({ ticket_id: 't1', snoozed_until: '-1' }, { operation: 'update_ticket' })
    ).toThrow('positive whole Unix timestamp')
  })

  it('does not send a stale conversation snooze value with a canvas ticket update', () => {
    const inputs = { operation: 'update_ticket', ticket_id: 't1', snoozed_until: '5' }
    const sent = { ...inputs, ...mapParams(inputs) }
    expect(sent.snoozed_until).toBeUndefined()
  })
})

describe('Intercom role defaults', () => {
  const role = IntercomV2Block.subBlocks.find((subBlock) => subBlock.id === 'role')

  it('leads with No change everywhere except a known Create Contact', () => {
    const options = role?.options
    if (typeof options !== 'function') throw new Error('role options are static')
    expect(options({ values: {} })[0]?.id).toBe('')
    expect(options({ values: { operation: 'update_contact' } })[0]?.id).toBe('')
    expect(options({ values: { operation: 'create_contact' } })[0]?.id).toBe('lead')
    expect(options()[0]?.id).toBe('lead')
  })
})

describe('Intercom tool-row fields on a tool call', () => {
  it.each([
    { operation: 'update_ticket', field: 'ticket_assignee_id', param: 'assignee_id' },
    { operation: 'create_contact', field: 'contact_company_id', param: 'company_id' },
    { operation: 'close_conversation', field: 'close_body', param: 'body' },
    { operation: 'assign_conversation', field: 'assign_body', param: 'body' },
    { operation: 'create_note', field: 'note_body', param: 'body' },
    { operation: 'create_note', field: 'tag_contact_id', param: 'contactId' },
    { operation: 'attach_contact_to_company', field: 'attach_company_id', param: 'companyId' },
    { operation: 'create_tag', field: 'tag_name', param: 'name' },
    { operation: 'create_tag', field: 'tag_id_update', param: 'id' },
    { operation: 'create_event', field: 'event_user_id', param: 'user_id' },
    { operation: 'create_event', field: 'event_email', param: 'email' },
    { operation: 'create_event', field: 'event_contact_id', param: 'id' },
    { operation: 'create_event', field: 'event_metadata', param: 'metadata' },
    { operation: 'create_message', field: 'message_type_msg', param: 'message_type' },
    { operation: 'create_company', field: 'company_name', param: 'name' },
  ])(
    'keeps the pinned $field over the model $param on $operation',
    ({ operation, field, param }) => {
      const mapped = mapParams({ [field]: 'pinned', [param]: 'model' }, { operation })
      expect(mapped[param]).toBe('pinned')
    }
  )

  it('fills a param from the model when the row leaves its field empty', () => {
    expect(mapParams({ assignee_id: 'model' }, { operation: 'update_ticket' }).assignee_id).toBe(
      'model'
    )
  })
})
