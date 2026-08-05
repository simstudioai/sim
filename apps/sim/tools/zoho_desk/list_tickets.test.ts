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
 * The block maps subBlock values onto tool params, so a value the mapper drops
 * never reaches the tool's validation and the request silently runs unfiltered.
 * These cover the seam rather than either side of it.
 */
describe('ZohoDeskBlock receivedInDays reaches the tool intact', () => {
  const buildParams = ZohoDeskBlock.tools.config?.params
  const buildUrl = zohoDeskListTicketsTool.request.url as (p: Record<string, unknown>) => string

  const throughBlock = (receivedInDays: unknown) => {
    if (!buildParams) throw new Error('ZohoDeskBlock is missing tools.config.params')
    const mapped = buildParams({ operation: 'list_tickets', receivedInDays }) as Record<
      string,
      unknown
    >
    return buildUrl({ accessToken: 'tok', orgId: '700', ...mapped })
  }

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
