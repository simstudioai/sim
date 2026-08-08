/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ZohoDeskBlock } from '@/blocks/blocks/zoho-desk'
import { zohoDeskListTicketsTool } from '@/tools/zoho_desk/list_tickets'

describe('zohoDeskListTicketsTool request url', () => {
  const base = { accessToken: 'tok', orgId: '700' }
  const buildUrl = zohoDeskListTicketsTool.request.url as (p: Record<string, unknown>) => string

  const queryOf = (params: Record<string, unknown>) =>
    new URL(buildUrl({ ...base, ...params })).searchParams

  it('omits the query string entirely when no filters are set', () => {
    expect(buildUrl(base)).toBe('https://desk.zoho.com/api/v1/tickets')
  })

  it('forwards the documented filters', () => {
    const query = queryOf({ assignee: 'Unassigned', channel: 'Email,Web', receivedInDays: 30 })
    expect(query.get('assignee')).toBe('Unassigned')
    expect(query.get('channel')).toBe('Email,Web')
    expect(query.get('receivedInDays')).toBe('30')
  })

  // Zoho documents exactly 15/30/90. `receivedInDays` is LLM-writable, so a
  // dropped out-of-range value would hand back the whole unfiltered queue while
  // the caller believes it was filtered - fail instead of lying.
  it('rejects a receivedInDays value Zoho does not accept', () => {
    for (const receivedInDays of [7, 0, 45, 91, 30.5, '7', 'abc']) {
      expect(() => buildUrl({ ...base, receivedInDays })).toThrow(/must be 15, 30, or 90/)
    }
  })

  // The tool layer does not coerce declared param types, and the agent tool
  // panel stores every picked value as a string - so the documented values must
  // survive arriving as '15' / '30' / '90'.
  it('accepts the string form the agent tool panel stores', () => {
    expect(queryOf({ receivedInDays: '30' }).get('receivedInDays')).toBe('30')
  })

  it('collapses "a, b" to "a,b" on every comma-separated filter', () => {
    const query = queryOf({
      include: 'contacts, assignee',
      channel: 'Email, Web',
      status: 'Open, On Hold',
    })
    expect(query.get('include')).toBe('contacts,assignee')
    expect(query.get('channel')).toBe('Email,Web')
    // Interior spaces survive - "On Hold" is one status, not two.
    expect(query.get('status')).toBe('Open,On Hold')
  })
})

/**
 * Models the real block-to-tool seam. The executor merges the mapper's output
 * ON TOP of the serialized inputs (`{ ...inputs, ...transformedParams }` in
 * executor/handlers/generic/generic-handler.ts), so the mapper can overwrite a
 * key but never remove one. A test that passes only the mapper's return value
 * would miss every stale input the merge restores — which is precisely the
 * class of bug these cover.
 */
function throughSeam(inputs: Record<string, unknown>): string {
  const buildParams = ZohoDeskBlock.tools.config?.params
  if (!buildParams) throw new Error('ZohoDeskBlock is missing tools.config.params')
  const buildUrl = zohoDeskListTicketsTool.request.url as (p: Record<string, unknown>) => string
  const withCreds = { accessToken: 'tok', orgId: '700', ...inputs }
  const transformed = buildParams(withCreds) as Record<string, unknown>
  return buildUrl({ ...withCreds, ...transformed })
}

describe('ZohoDeskBlock receivedInDays reaches the tool intact', () => {
  const throughBlock = (receivedInDays: unknown) =>
    throughSeam({ operation: 'list_tickets', receivedInDays })

  it('carries a supported window through to the query', () => {
    expect(new URL(throughBlock('30')).searchParams.get('receivedInDays')).toBe('30')
  })

  it('lets an unsupported value reach the tool and throw instead of silently unfiltering', () => {
    for (const value of [7, '7', 30.5, 'abc']) {
      expect(() => throughBlock(value)).toThrow(/must be 15, 30, or 90/)
    }
  })

  it('treats the "Any time" option as no filter at all', () => {
    expect(new URL(throughBlock('')).searchParams.has('receivedInDays')).toBe(false)
  })
})

/**
 * Get Ticket accepts `contract` and `skills`; List Tickets does not document
 * either. A shared subBlock would carry them across an operation switch and put
 * an undocumented token on the wire, so each endpoint owns its own field.
 */
describe('ZohoDeskBlock keeps the two include vocabularies apart', () => {
  const buildParams = ZohoDeskBlock.tools.config?.params

  const merged = (operation: string) => {
    if (!buildParams) throw new Error('ZohoDeskBlock is missing tools.config.params')
    const inputs = {
      operation,
      include: 'contacts,assignee',
      ticketInclude: 'contacts,skills',
    }
    return { ...inputs, ...(buildParams(inputs) as Record<string, unknown>) }
  }

  it('sends the list vocabulary to list_tickets', () => {
    expect(merged('list_tickets').include).toBe('contacts,assignee')
  })

  it('sends the single-ticket vocabulary to get_ticket', () => {
    expect(merged('get_ticket').include).toBe('contacts,skills')
  })

  it('never leaks skills onto the list endpoint', () => {
    expect(merged('list_tickets').include).not.toContain('skills')
  })

  // A workflow saved before the split stored its value under `include`. Dropping
  // it would silently stop embedding what the workflow asked for.
  it('falls back to the legacy include for a workflow saved before the split', () => {
    if (!buildParams) throw new Error('ZohoDeskBlock is missing tools.config.params')
    const legacy = { operation: 'get_ticket', ticketId: '1', include: 'contacts,products' }
    const result = { ...legacy, ...(buildParams(legacy) as Record<string, unknown>) }
    expect(result.include).toBe('contacts,products')
  })

  it('prefers the new field once the workflow sets it', () => {
    if (!buildParams) throw new Error('ZohoDeskBlock is missing tools.config.params')
    const both = {
      operation: 'get_ticket',
      ticketId: '1',
      include: 'contacts',
      ticketInclude: 'skills',
    }
    const result = { ...both, ...(buildParams(both) as Record<string, unknown>) }
    expect(result.include).toBe('skills')
  })
})

/**
 * A `mode: 'advanced'` subBlock keeps its value when the operation changes, and
 * the serializer emits it for ANY operation while the block's advanced toggle is
 * off — it returns on `isNonEmptyValue` without evaluating the subBlock's
 * `condition`. So these stale values genuinely arrive under the wrong operation,
 * and the mapper has to overwrite them rather than merely decline to set them.
 */
describe('ZohoDeskBlock overwrites stale advanced values from another operation', () => {
  const buildParams = ZohoDeskBlock.tools.config?.params

  const merged = (inputs: Record<string, unknown>) => {
    if (!buildParams) throw new Error('ZohoDeskBlock is missing tools.config.params')
    return { ...inputs, ...(buildParams(inputs) as Record<string, unknown>) }
  }

  it('does not carry a List Tickets sort field onto List Comments', () => {
    const result = merged({ operation: 'list_comments', ticketId: '1', sortBy: 'createdTime' })
    expect(result.sortBy).toBeUndefined()
  })

  it('does not carry a ticket include onto Get Contact or Get Thread', () => {
    expect(
      merged({ operation: 'get_contact', contactId: '9', include: 'contacts,assignee' }).include
    ).toBeUndefined()
    expect(
      merged({ operation: 'get_thread', ticketId: '1', threadId: '2', include: 'contacts' }).include
    ).toBeUndefined()
  })

  it('does not carry list-only filters onto another operation', () => {
    const result = merged({
      operation: 'get_ticket',
      ticketId: '1',
      assigneeFilter: 'Unassigned',
      channelFilter: 'Email',
      receivedInDays: '30',
    })
    expect(result.assignee).toBeUndefined()
    expect(result.channel).toBeUndefined()
    expect(result.receivedInDays).toBeUndefined()
  })

  it('discards an out-of-range pagination value instead of forwarding it', () => {
    const result = merged({ operation: 'list_tickets', from: '-5', limit: '0' })
    expect(result.from).toBeUndefined()
    expect(result.limit).toBeUndefined()
  })

  it('survives an emptied department multi-select without throwing', () => {
    expect(() => throughSeam({ operation: 'list_tickets', departmentIds: [] })).not.toThrow()
    expect(
      new URL(throughSeam({ operation: 'list_tickets', departmentIds: [] })).searchParams.has(
        'departmentIds'
      )
    ).toBe(false)
  })

  it('does not throw on the "Any time" option the dropdown seeds', () => {
    expect(() => throughSeam({ operation: 'list_tickets', receivedInDays: '' })).not.toThrow()
  })
})

/**
 * On the agent-tool path `operation` is a sibling of the tool call rather than a
 * member of params, so the mapper cannot scope by it — and must not try. The
 * model addresses tool params by their real names, and the tool has already been
 * selected, so scoping there would erase the model's own arguments.
 */
describe('ZohoDeskBlock leaves agent-supplied params alone', () => {
  const buildParams = ZohoDeskBlock.tools.config?.params

  const merged = (llmArgs: Record<string, unknown>) => {
    if (!buildParams) throw new Error('ZohoDeskBlock is missing tools.config.params')
    return { ...llmArgs, ...(buildParams({ ...llmArgs }) as Record<string, unknown>) }
  }

  it('preserves every tool param the model supplied', () => {
    const result = merged({
      status: 'Open',
      priority: 'High',
      sortBy: '-createdTime',
      include: 'contacts',
      assignee: 'Unassigned',
      channel: 'Email',
      receivedInDays: 30,
      ticketId: '123',
    })
    expect(result).toMatchObject({
      status: 'Open',
      priority: 'High',
      sortBy: '-createdTime',
      include: 'contacts',
      assignee: 'Unassigned',
      channel: 'Email',
      receivedInDays: 30,
      ticketId: '123',
    })
  })

  it('still coerces a JSON custom-field string, which is a type fix not a gate', () => {
    expect(merged({ customFields: '{"cf_severity":"High"}' }).customFields).toEqual({
      cf_severity: 'High',
    })
    expect(() => merged({ customFields: '{not json' })).toThrow(/Invalid JSON/)
  })
})
