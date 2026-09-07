/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { extractErrorMessage } from '@/tools/error-extractors'
import { mailtrapCreateContactTool } from '@/tools/mailtrap/create_contact'
import { mailtrapDeleteContactTool } from '@/tools/mailtrap/delete_contact'
import { mailtrapGetContactTool } from '@/tools/mailtrap/get_contact'
import { mailtrapGetContactListTool } from '@/tools/mailtrap/get_contact_list'
import { mailtrapGetEmailLogTool } from '@/tools/mailtrap/get_email_log'
import { mailtrapListContactListsTool } from '@/tools/mailtrap/list_contact_lists'
import { mailtrapListEmailLogsTool } from '@/tools/mailtrap/list_email_logs'
import { mailtrapSendEmailTool } from '@/tools/mailtrap/send_email'
import type { MailtrapSendEmailParams } from '@/tools/mailtrap/types'
import { mailtrapUpdateContactTool } from '@/tools/mailtrap/update_contact'
import {
  parseAddress,
  parseAddressList,
  parseIdList,
  parseJsonRecord,
} from '@/tools/mailtrap/utils'
import { tools } from '@/tools/registry'
import type { ToolConfig } from '@/tools/types'

vi.unmock('@/tools/registry')

function buildUrl<P, R>(tool: ToolConfig<P, R>, params: P): string {
  return typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
}

function buildBody<P, R>(tool: ToolConfig<P, R>, params: P): unknown {
  return tool.request.body?.(params)
}

const baseSendParams: MailtrapSendEmailParams = {
  apiToken: 'token-123',
  from: 'sender@example.com',
  to: 'recipient@example.com',
  subject: 'Hello',
  text: 'Welcome',
}

describe('mailtrap utils', () => {
  it('parses bare and named recipient addresses', () => {
    expect(parseAddressList('a@example.com, Jane Doe <jane@example.com>')).toEqual([
      { email: 'a@example.com' },
      { email: 'jane@example.com', name: 'Jane Doe' },
    ])
  })

  it('drops blank recipient entries', () => {
    expect(parseAddressList(' , a@example.com ,')).toEqual([{ email: 'a@example.com' }])
    expect(parseAddressList(undefined)).toEqual([])
  })

  it('rejects a recipient entry that is not an email address', () => {
    expect(() => parseAddressList('johndoe')).toThrow(/"johndoe" is not a valid email address/)
    expect(() => parseAddressList('a@example.com, Bob <bob>')).toThrow(
      /"Bob <bob>" is not a valid email address/
    )
  })

  it('rejects an unbalanced quote or angle bracket instead of absorbing recipients', () => {
    expect(() => parseAddressList('Bad <bad@example.com, good@example.com')).toThrow(
      /unbalanced quote or angle bracket/
    )
    expect(() => parseAddressList('"still open, a@example.com')).toThrow(
      /unbalanced quote or angle bracket/
    )
  })

  it('keeps commas that sit inside a quoted display name', () => {
    expect(
      parseAddressList(
        '"Doe, Jane" <jane@example.com>, ops@example.com, "Smith, Bob" <bob@example.com>'
      )
    ).toEqual([
      { email: 'jane@example.com', name: 'Doe, Jane' },
      { email: 'ops@example.com' },
      { email: 'bob@example.com', name: 'Smith, Bob' },
    ])
    expect(parseAddress('"Doe, Jane" <jane@example.com>, ops@example.com')).toEqual({
      email: 'jane@example.com',
      name: 'Doe, Jane',
    })
  })

  it('parseAddress returns the first address or undefined', () => {
    expect(parseAddress('Jane <jane@example.com>')).toEqual({
      email: 'jane@example.com',
      name: 'Jane',
    })
    expect(parseAddress('a@example.com, b@example.com')).toEqual({ email: 'a@example.com' })
    expect(parseAddress('   ')).toBeUndefined()
    expect(parseAddress(undefined)).toBeUndefined()
  })

  it('parses a comma-separated id list and ignores non-numeric entries', () => {
    expect(parseIdList('1, 2 ,x, 3')).toEqual([1, 2, 3])
    // a malformed entry is dropped, not truncated to its numeric prefix
    expect(parseIdList('10, 12abc, 7')).toEqual([10, 7])
    expect(parseIdList('-1, 1.5, 2')).toEqual([2])
    expect(parseIdList(undefined)).toEqual([])
  })

  it('accepts an object or a JSON string and rejects non-objects', () => {
    expect(parseJsonRecord({ a: 1 }, 'fields')).toEqual({ a: 1 })
    expect(parseJsonRecord('{"a":1}', 'fields')).toEqual({ a: 1 })
    expect(parseJsonRecord('', 'fields')).toBeUndefined()
    expect(parseJsonRecord(undefined, 'fields')).toBeUndefined()
    expect(() => parseJsonRecord('[1,2]', 'fields')).toThrow(
      /Invalid fields: value is not a JSON object/
    )
    expect(() => parseJsonRecord('{bad json', 'fields')).toThrow(/Invalid fields/)
    // an upstream block can resolve a json param to an already-parsed array
    expect(() => parseJsonRecord([1, 2], 'fields')).toThrow(
      /Invalid fields: value is not a JSON object/
    )
  })
})

describe('mailtrap_send_email', () => {
  it('is registered under its snake_case id', () => {
    expect(tools.mailtrap_send_email).toBe(mailtrapSendEmailTool)
  })

  it('routes each stream to the correct host', () => {
    expect(buildUrl(mailtrapSendEmailTool, baseSendParams)).toBe(
      'https://send.api.mailtrap.io/api/send'
    )
    expect(buildUrl(mailtrapSendEmailTool, { ...baseSendParams, stream: 'bulk' })).toBe(
      'https://bulk.api.mailtrap.io/api/send'
    )
    expect(
      buildUrl(mailtrapSendEmailTool, {
        ...baseSendParams,
        stream: 'sandbox',
        sandboxId: '99',
      })
    ).toBe('https://sandbox.api.mailtrap.io/api/send/99')
  })

  it('requires a sandbox id for the sandbox stream', () => {
    expect(() => buildUrl(mailtrapSendEmailTool, { ...baseSendParams, stream: 'sandbox' })).toThrow(
      /sandboxId is required/
    )
  })

  it('rejects an unknown stream instead of building an "undefined" host', () => {
    expect(() =>
      buildUrl(mailtrapSendEmailTool, { ...baseSendParams, stream: 'production' as never })
    ).toThrow(/Invalid stream "production"/)
  })

  it('parses the from address and rejects a missing one', () => {
    const body = buildBody(mailtrapSendEmailTool, {
      ...baseSendParams,
      from: 'Acme Support <support@acme.com>',
    }) as Record<string, unknown>
    expect(body.from).toEqual({ email: 'support@acme.com', name: 'Acme Support' })

    expect(() => buildBody(mailtrapSendEmailTool, { ...baseSendParams, from: '  ' })).toThrow(
      /from is required/
    )
  })

  it('rejects a send with no subject and with no body/template', () => {
    expect(() => buildBody(mailtrapSendEmailTool, { ...baseSendParams, subject: '   ' })).toThrow(
      /subject is required/
    )
    expect(() =>
      buildBody(mailtrapSendEmailTool, { ...baseSendParams, text: undefined, html: undefined })
    ).toThrow(/text body, an html body, or a templateUuid/)
  })

  it('accepts a template-only send with no text or html', () => {
    const body = buildBody(mailtrapSendEmailTool, {
      ...baseSendParams,
      text: undefined,
      html: undefined,
      templateUuid: 'b81aabcd-1a1e-41cf-91b6-eca0254b3d96',
      templateVariables: { user_name: 'Jo' },
    }) as Record<string, unknown>
    expect(body).toMatchObject({
      template_uuid: 'b81aabcd-1a1e-41cf-91b6-eca0254b3d96',
      template_variables: { user_name: 'Jo' },
    })
  })

  it('builds the request body with parsed recipients and optional blocks', () => {
    const body = buildBody(mailtrapSendEmailTool, {
      ...baseSendParams,
      from: 'Acme <sender@example.com>',
      cc: 'cc@example.com, CC Two <cc2@example.com>',
      replyTo: 'Support <support@example.com>',
      customVariables: '{"order_id":"7"}',
    }) as Record<string, unknown>

    expect(body).toMatchObject({
      from: { email: 'sender@example.com', name: 'Acme' },
      to: [{ email: 'recipient@example.com' }],
      cc: [{ email: 'cc@example.com' }, { email: 'cc2@example.com', name: 'CC Two' }],
      reply_to: { email: 'support@example.com', name: 'Support' },
      subject: 'Hello',
      text: 'Welcome',
      custom_variables: { order_id: '7' },
    })
    expect(body).not.toHaveProperty('bcc')
  })

  it('accepts a bcc-only send and omits an empty to', () => {
    const body = buildBody(mailtrapSendEmailTool, {
      ...baseSendParams,
      to: undefined,
      bcc: 'hidden@example.com',
    }) as Record<string, unknown>
    expect(body).not.toHaveProperty('to')
    expect(body.bcc).toEqual([{ email: 'hidden@example.com' }])
  })

  it('rejects a send with no recipient in to, cc, or bcc', () => {
    expect(() => buildBody(mailtrapSendEmailTool, { ...baseSendParams, to: undefined })).toThrow(
      /at least one recipient/
    )
  })

  it('normalizes the send response into message ids', async () => {
    const result = await mailtrapSendEmailTool.transformResponse?.(
      new Response(JSON.stringify({ success: true, message_ids: ['abc', 'def'] })),
      baseSendParams
    )
    expect(result?.output).toEqual({ success: true, messageIds: ['abc', 'def'] })
  })

  it('fails when a 2xx body does not confirm the send', async () => {
    await expect(
      mailtrapSendEmailTool.transformResponse?.(
        new Response(JSON.stringify({ success: false, errors: ['sending domain not verified'] })),
        baseSendParams
      )
    ).rejects.toThrow(/did not confirm the send: sending domain not verified/)
  })
})

describe('mailtrap contact tools', () => {
  it('wraps the create payload under a contact key', () => {
    const body = buildBody(mailtrapCreateContactTool, {
      apiToken: 't',
      email: 'c@example.com',
      fields: { first_name: 'C' },
      listIds: '1, 2',
    }) as Record<string, unknown>

    expect(body).toEqual({
      contact: { email: 'c@example.com', fields: { first_name: 'C' }, list_ids: [1, 2] },
    })
  })

  it('maps the contact response to camelCase output', async () => {
    const result = await mailtrapCreateContactTool.transformResponse?.(
      new Response(
        JSON.stringify({
          data: {
            id: 'uuid-1',
            email: 'c@example.com',
            fields: { first_name: 'C' },
            list_ids: [1],
            status: 'subscribed',
            created_at: 111,
            updated_at: 222,
          },
        })
      ),
      { apiToken: 't', email: 'c@example.com' }
    )

    expect(result?.output.contact).toEqual({
      id: 'uuid-1',
      email: 'c@example.com',
      fields: { first_name: 'C' },
      listIds: [1],
      status: 'subscribed',
      createdAt: 111,
      updatedAt: 222,
    })
  })

  it('fails a well-formed body that is missing the contact payload', async () => {
    await expect(
      mailtrapGetContactTool.transformResponse?.(new Response('{}'), {
        apiToken: 't',
        contactIdentifier: 'c@example.com',
      })
    ).rejects.toThrow(/did not include the contact payload/)
  })

  it('fails a contact list response with no numeric id', async () => {
    await expect(
      mailtrapGetContactListTool.transformResponse?.(
        new Response(JSON.stringify({ name: 'News' })),
        {
          apiToken: 't',
          listId: '1',
        }
      )
    ).rejects.toThrow(/did not include a contact list id/)
  })

  it('sends include/exclude list ids and the unsubscribe flag on update', () => {
    const body = buildBody(mailtrapUpdateContactTool, {
      apiToken: 't',
      contactIdentifier: 'c@example.com',
      email: 'c@example.com',
      listIdsIncluded: '3',
      listIdsExcluded: '4, 5',
      unsubscribed: true,
    }) as { contact: Record<string, unknown> }

    expect(body.contact).toEqual({
      email: 'c@example.com',
      list_ids_included: [3],
      list_ids_excluded: [4, 5],
      unsubscribed: true,
    })
  })

  it('coerces a string "true"/"false" unsubscribe flag from the LLM path', () => {
    const on = buildBody(mailtrapUpdateContactTool, {
      apiToken: 't',
      contactIdentifier: 'c@example.com',
      email: 'c@example.com',
      unsubscribed: 'true' as unknown as boolean,
    }) as { contact: Record<string, unknown> }
    expect(on.contact.unsubscribed).toBe(true)

    const off = buildBody(mailtrapUpdateContactTool, {
      apiToken: 't',
      contactIdentifier: 'c@example.com',
      email: 'c@example.com',
      unsubscribed: 'false' as unknown as boolean,
    }) as { contact: Record<string, unknown> }
    expect(off.contact.unsubscribed).toBe(false)

    const omitted = buildBody(mailtrapUpdateContactTool, {
      apiToken: 't',
      contactIdentifier: 'c@example.com',
      email: 'c@example.com',
    }) as { contact: Record<string, unknown> }
    expect(omitted.contact).not.toHaveProperty('unsubscribed')
  })

  it('reports a deleted contact without reading the empty 204 body', async () => {
    const result = await mailtrapDeleteContactTool.transformResponse?.(
      new Response(null, { status: 204 }),
      { apiToken: 't', contactIdentifier: 'c@example.com' }
    )
    expect(result?.output).toEqual({ success: true, deleted: true })
  })

  it('appends the search filter only when provided', () => {
    expect(buildUrl(mailtrapListContactListsTool, { apiToken: 't' })).toBe(
      'https://mailtrap.io/api/contacts/lists'
    )
    expect(buildUrl(mailtrapListContactListsTool, { apiToken: 't', search: 'news' })).toBe(
      'https://mailtrap.io/api/contacts/lists?search=news'
    )
  })

  it('coerces contact list entries and drops a null entry', async () => {
    const ok = await mailtrapListContactListsTool.transformResponse?.(
      new Response(JSON.stringify([{ id: 1, name: 'A' }, { id: 2 }, null])),
      { apiToken: 't' }
    )
    expect(ok?.output.lists).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: '' },
    ])
  })

  it('fails when the contact lists response is not a JSON array', async () => {
    await expect(
      mailtrapListContactListsTool.transformResponse?.(new Response(''), { apiToken: 't' })
    ).rejects.toThrow(/empty response body/)
    await expect(
      mailtrapListContactListsTool.transformResponse?.(new Response('{"data":[]}'), {
        apiToken: 't',
      })
    ).rejects.toThrow(/expected a JSON array/)
  })
})

describe('mailtrap email logs tools', () => {
  it('builds the deep-object filter query, omitting empty fields', () => {
    expect(buildUrl(mailtrapListEmailLogsTool, { apiToken: 't' })).toBe(
      'https://mailtrap.io/api/email_logs'
    )
    expect(
      buildUrl(mailtrapListEmailLogsTool, {
        apiToken: 't',
        sentAfter: '2025-01-01T00:00:00Z',
        to: 'a@example.com',
        status: 'delivered',
        searchAfter: 'cursor-1',
      })
    ).toBe(
      'https://mailtrap.io/api/email_logs?search_after=cursor-1' +
        '&filters[sent_after]=2025-01-01T00%3A00%3A00Z' +
        '&filters[to][operator]=ci_equal&filters[to][value]=a%40example.com' +
        '&filters[status][operator]=equal&filters[status][value]=delivered'
    )
  })

  it('defaults the subject filter to a case-insensitive substring match', () => {
    expect(
      buildUrl(mailtrapListEmailLogsTool, { apiToken: 't', subject: 'Order confirmation' })
    ).toBe(
      'https://mailtrap.io/api/email_logs?filters[subject][operator]=ci_contain' +
        '&filters[subject][value]=Order%20confirmation'
    )
  })

  it('honors subjectMatch "equal"', () => {
    expect(
      buildUrl(mailtrapListEmailLogsTool, {
        apiToken: 't',
        subject: 'Weekly digest',
        subjectMatch: 'equal',
      })
    ).toBe(
      'https://mailtrap.io/api/email_logs?filters[subject][operator]=ci_equal' +
        '&filters[subject][value]=Weekly%20digest'
    )
  })

  it('emits an operator-only subject filter for subjectMatch "empty" and ignores the value', () => {
    expect(
      buildUrl(mailtrapListEmailLogsTool, {
        apiToken: 't',
        subject: 'ignored',
        subjectMatch: 'empty',
      })
    ).toBe('https://mailtrap.io/api/email_logs?filters[subject][operator]=empty')
  })

  it('rejects an unknown subjectMatch', () => {
    expect(() =>
      buildUrl(mailtrapListEmailLogsTool, {
        apiToken: 't',
        subject: 'x',
        subjectMatch: 'startsWith' as never,
      })
    ).toThrow(/Invalid subjectMatch "startsWith"/)
  })

  it('sends a comma-separated status/category filter as an array', () => {
    expect(
      buildUrl(mailtrapListEmailLogsTool, {
        apiToken: 't',
        status: 'delivered, enqueued',
        category: 'welcome',
      })
    ).toBe(
      'https://mailtrap.io/api/email_logs?filters[status][operator]=equal' +
        '&filters[status][value][]=delivered&filters[status][value][]=enqueued' +
        '&filters[category][operator]=equal&filters[category][value]=welcome'
    )
  })

  it('drops a filter whose comma-separated value is empty', () => {
    expect(buildUrl(mailtrapListEmailLogsTool, { apiToken: 't', status: ' , ' })).toBe(
      'https://mailtrap.io/api/email_logs'
    )
  })

  it('normalizes the email logs list response', async () => {
    const result = await mailtrapListEmailLogsTool.transformResponse?.(
      new Response(
        JSON.stringify({
          messages: [
            {
              message_id: 'm-1',
              status: 'delivered',
              subject: 'Hi',
              from: 's@x.com',
              to: 'r@x.com',
              sent_at: '2025-01-15T10:30:00Z',
              client_ip: null,
              category: null,
              custom_variables: {},
              sending_stream: 'transactional',
              domain_id: 3938,
              template_id: null,
              template_variables: {},
              opens_count: 2,
              clicks_count: 1,
            },
          ],
          total_count: 42,
          next_page_cursor: 'm-1',
        })
      ),
      { apiToken: 't' }
    )
    expect(result?.output.totalCount).toBe(42)
    expect(result?.output.nextPageCursor).toBe('m-1')
    expect(result?.output.messages[0]).toMatchObject({
      messageId: 'm-1',
      status: 'delivered',
      subject: 'Hi',
      clientIp: null,
      category: null,
      domainId: 3938,
      templateId: null,
      opensCount: 2,
      references: [],
      threadId: null,
    })
  })

  it('tolerates a null entry in the messages array', async () => {
    const result = await mailtrapListEmailLogsTool.transformResponse?.(
      new Response(JSON.stringify({ messages: [null], total_count: 1, next_page_cursor: null })),
      { apiToken: 't' }
    )
    expect(result?.output.messages).toHaveLength(1)
    expect(result?.output.messages[0]).toMatchObject({
      messageId: '',
      references: [],
      opensCount: 0,
    })
  })

  it('maps a single email log message with events and raw url', async () => {
    const result = await mailtrapGetEmailLogTool.transformResponse?.(
      new Response(
        JSON.stringify({
          message_id: 'm-2',
          status: 'delivered',
          from: 's@x.com',
          to: 'r@x.com',
          sent_at: '2025-01-15T10:30:00Z',
          sending_stream: 'bulk',
          domain_id: 1,
          opens_count: 0,
          clicks_count: 0,
          raw_message_url: 'https://storage.example.com/signed/eml/m-2?token=abc',
          events: [{ event_type: 'click', created_at: '2025-01-15T10:35:00Z', details: {} }],
        })
      ),
      { apiToken: 't', messageId: 'm-2' }
    )
    expect(result?.output.message.messageId).toBe('m-2')
    expect(result?.output.message.rawMessageUrl).toBe(
      'https://storage.example.com/signed/eml/m-2?token=abc'
    )
    expect(result?.output.message.events).toHaveLength(1)
  })

  it('url-encodes the message id in the get path', () => {
    expect(buildUrl(mailtrapGetEmailLogTool, { apiToken: 't', messageId: 'a b/c' })).toBe(
      'https://mailtrap.io/api/email_logs/a%20b%2Fc'
    )
  })

  it('fails when the list response has no messages array', async () => {
    await expect(
      mailtrapListEmailLogsTool.transformResponse?.(
        new Response(JSON.stringify({ messages: 'bad', total_count: 0 })),
        { apiToken: 't' }
      )
    ).rejects.toThrow(/did not include a messages array/)
  })

  it('fails a single message response with no message id', async () => {
    await expect(
      mailtrapGetEmailLogTool.transformResponse?.(
        new Response(JSON.stringify({ status: 'delivered' })),
        { apiToken: 't', messageId: 'm-9' }
      )
    ).rejects.toThrow(/did not include a message id/)
  })
})

describe('mailtrap transformResponse invariants', () => {
  const withTransform = Object.entries(tools).filter(
    ([id, tool]) => id.startsWith('mailtrap_') && typeof tool.transformResponse === 'function'
  )
  // The delete tools return `204` and ignore the body; every other tool reads it.
  const bodyReading = withTransform.filter(([, tool]) => (tool.transformResponse?.length ?? 0) > 0)
  const bodyIgnoring = withTransform.filter(
    ([, tool]) => (tool.transformResponse?.length ?? 0) === 0
  )

  it('covers every mailtrap tool', () => {
    expect(withTransform.length).toBe(12)
    expect(bodyIgnoring.map(([id]) => id).sort()).toEqual([
      'mailtrap_delete_contact',
      'mailtrap_delete_contact_list',
    ])
  })

  it.each(bodyReading)('%s rejects an empty 2xx body', async (_id, tool) => {
    await expect(tool.transformResponse?.(new Response('', { status: 200 }), {})).rejects.toThrow(
      /empty response body/
    )
  })

  it.each(bodyReading)('%s rejects a non-JSON 2xx body', async (_id, tool) => {
    await expect(
      tool.transformResponse?.(new Response('<html>gateway</html>', { status: 200 }), {})
    ).rejects.toThrow(/non-JSON response body/)
  })

  it.each(bodyIgnoring)('%s ignores the body and reports success', async (_id, tool) => {
    const result = await tool.transformResponse?.(new Response('', { status: 200 }), {})
    expect(result?.success).toBe(true)
  })
})

describe('mailtrap error extractor', () => {
  it('reads the sending API errors array', () => {
    expect(
      extractErrorMessage(
        { status: 400, data: { success: false, errors: ["'from' is required", 'other'] } },
        'mailtrap-errors'
      )
    ).toBe("'from' is required")
  })

  it('reads the account API errors string', () => {
    expect(
      extractErrorMessage(
        { status: 404, data: { errors: 'Contact(s) not found' } },
        'mailtrap-errors'
      )
    ).toBe('Contact(s) not found')
  })

  it('flattens a 422 validation map', () => {
    expect(
      extractErrorMessage(
        { status: 422, data: { errors: { email: ['is invalid'] } } },
        'mailtrap-errors'
      )
    ).toBe('email is invalid')
  })
})
