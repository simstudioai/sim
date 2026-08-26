/**
 * @vitest-environment node
 *
 * Guards the six Salesforce list tools that assemble a SOQL statement by string
 * interpolation.
 *
 * `fields`, `orderBy`, and `limit` are all `visibility: 'user-or-llm'`, so a
 * prompt-injected agent controls them. Interpolated raw, `fields` could open a
 * subquery and `orderBy` could append clauses — rewriting the statement into
 * something the caller never asked for. That matters even though
 * `salesforce_query` exists: Copilot tool permissions are per-tool and stored
 * verbatim, so a workspace that denies `salesforce_query` while allowing
 * `salesforce_get_contacts` would have that denial silently bypassed.
 *
 * Every assertion decodes the built URL's `q` parameter with `new URL(...)` —
 * the same normalization `fetch` performs — and inspects the statement the org
 * would actually receive, rather than string-matching the template.
 */
import { describe, expect, it } from 'vitest'
import { salesforceGetAccountsTool } from '@/tools/salesforce/get_accounts'
import { salesforceGetCasesTool } from '@/tools/salesforce/get_cases'
import { salesforceGetContactsTool } from '@/tools/salesforce/get_contacts'
import { salesforceGetLeadsTool } from '@/tools/salesforce/get_leads'
import { salesforceGetOpportunitiesTool } from '@/tools/salesforce/get_opportunities'
import { salesforceGetTasksTool } from '@/tools/salesforce/get_tasks'
import {
  SoqlValidationError,
  sanitizeSoqlFieldList,
  sanitizeSoqlLimit,
  sanitizeSoqlOrderBy,
} from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const INSTANCE_URL = 'https://example.my.salesforce.com'

const LIST_TOOLS: ReadonlyArray<{ name: string; tool: AnyTool; object: string }> = [
  { name: 'salesforce_get_contacts', tool: salesforceGetContactsTool, object: 'Contact' },
  { name: 'salesforce_get_accounts', tool: salesforceGetAccountsTool, object: 'Account' },
  { name: 'salesforce_get_leads', tool: salesforceGetLeadsTool, object: 'Lead' },
  {
    name: 'salesforce_get_opportunities',
    tool: salesforceGetOpportunitiesTool,
    object: 'Opportunity',
  },
  { name: 'salesforce_get_cases', tool: salesforceGetCasesTool, object: 'Case' },
  { name: 'salesforce_get_tasks', tool: salesforceGetTasksTool, object: 'Task' },
]

/**
 * Fragments that rewrite the statement when interpolated raw. Each is tried in
 * both `fields` and `orderBy`; none is a legal field API name or sort clause.
 */
const INJECTIONS = [
  'Id,(SELECT Name FROM Account)',
  'Id FROM User WHERE IsActive = true LIMIT 1',
  'Id,(SELECT Id,Name FROM Contacts)',
  "Id WHERE Name != ''",
  'Id LIMIT 2000',
  'Id) UNION (SELECT Id',
  'Id,toLabel(Status)',
  'Id,COUNT(Id)',
  "Id,'literal'",
  'Id;DROP',
  'Id\nFROM User',
] as const

/** Field lists and sort clauses SOQL genuinely accepts; none may be rejected. */
const LEGITIMATE_FIELDS = [
  'Id',
  'Id,Name',
  'Id, Name, Email',
  'Account.Name',
  'Owner.Profile.Name',
  'Custom_Field__c',
  'Account__r.Region__c',
  'A.B.C.D.E',
] as const

const LEGITIMATE_ORDER_BY = [
  'Name',
  'Name ASC',
  'CreatedDate DESC',
  'Account.Name ASC',
  'Name ASC NULLS LAST',
  'LastName NULLS FIRST',
  'LastName ASC, CreatedDate DESC',
  'name desc nulls last',
] as const

/**
 * Builds the SOQL statement a tool would send, with no record id set so the
 * list branch (rather than the single-record branch) is taken.
 */
function buildQuery(tool: AnyTool, overrides: Record<string, unknown> = {}): string {
  const url = new URL(
    (tool.request!.url as (p: any) => string)({
      accessToken: 'token',
      instanceUrl: INSTANCE_URL,
      ...overrides,
    })
  )
  return url.searchParams.get('q') ?? ''
}

describe.each(LIST_TOOLS)('$name SOQL safety', ({ tool, object }) => {
  it('builds its default statement against the expected object', () => {
    const query = buildQuery(tool)

    expect(query).toMatch(new RegExp(`^SELECT .+ FROM ${object} ORDER BY .+ LIMIT 100$`))
  })

  it.each(INJECTIONS)('rejects %j in fields', (value) => {
    expect(() => buildQuery(tool, { fields: value })).toThrow(SoqlValidationError)
  })

  it.each(INJECTIONS)('rejects %j in orderBy', (value) => {
    expect(() => buildQuery(tool, { orderBy: value })).toThrow(SoqlValidationError)
  })

  it.each(LEGITIMATE_FIELDS)('passes %j through as the fields list', (value) => {
    const query = buildQuery(tool, { fields: value })

    expect(query.slice('SELECT '.length, query.indexOf(` FROM ${object}`))).toBe(
      value
        .split(',')
        .map((entry) => entry.trim())
        .join(', ')
    )
  })

  it.each(LEGITIMATE_ORDER_BY)('passes %j through as the sort clause', (value) => {
    const query = buildQuery(tool, { orderBy: value })
    const clause = query.slice(
      query.indexOf('ORDER BY ') + 'ORDER BY '.length,
      query.indexOf(' LIMIT')
    )

    expect(clause.toUpperCase()).toBe(
      value
        .split(',')
        .map((entry) => entry.trim().replace(/\s+/g, ' '))
        .join(', ')
        .toUpperCase()
    )
  })

  it.each(['abc', '', ' ', '10; DROP', '-1', '0', '2001', '1.5', 'NaN'] as const)(
    'rejects %j as a limit rather than emitting LIMIT NaN',
    (value) => {
      // An unset limit legitimately falls back to the default; only junk throws.
      if (value.trim() === '') {
        expect(buildQuery(tool, { limit: value })).toContain('LIMIT 100')
        return
      }
      expect(() => buildQuery(tool, { limit: value })).toThrow(SoqlValidationError)
    }
  )

  it('accepts the documented 2000-row ceiling', () => {
    expect(buildQuery(tool, { limit: '2000' })).toContain('LIMIT 2000')
  })
})

describe('sanitizeSoqlFieldList', () => {
  it('falls back to the tool default when unset or blank', () => {
    expect(sanitizeSoqlFieldList(undefined, 'Id,Name')).toBe('Id, Name')
    expect(sanitizeSoqlFieldList('   ', 'Id,Name')).toBe('Id, Name')
  })

  it('rejects a path deeper than the five relationship levels SOQL allows', () => {
    expect(() => sanitizeSoqlFieldList('A.B.C.D.E.F', 'Id')).toThrow(
      /at most 5|relationship levels/
    )
  })

  it('rejects a list that is only separators', () => {
    expect(() => sanitizeSoqlFieldList(',,,', 'Id')).toThrow(SoqlValidationError)
  })
})

describe('sanitizeSoqlOrderBy', () => {
  it('normalizes keyword casing so the emitted clause is stable', () => {
    expect(sanitizeSoqlOrderBy('name desc nulls last', 'Id ASC')).toBe('name DESC NULLS LAST')
  })

  it('rejects NULLS without a position', () => {
    expect(() => sanitizeSoqlOrderBy('Name ASC NULLS', 'Id ASC')).toThrow(/FIRST or LAST/)
  })

  it('rejects a trailing token after a complete clause', () => {
    expect(() => sanitizeSoqlOrderBy('Name ASC NULLS LAST LIMIT', 'Id ASC')).toThrow(
      SoqlValidationError
    )
  })
})

describe('sanitizeSoqlLimit', () => {
  it('defaults to 100 when unset', () => {
    expect(sanitizeSoqlLimit(undefined)).toBe(100)
    expect(sanitizeSoqlLimit('')).toBe(100)
  })

  it('accepts numbers as well as strings', () => {
    expect(sanitizeSoqlLimit(250)).toBe(250)
    expect(sanitizeSoqlLimit('250')).toBe(250)
  })

  it('names the failure instead of emitting LIMIT NaN', () => {
    expect(() => sanitizeSoqlLimit('abc')).toThrow(SoqlValidationError)
    expect(() => sanitizeSoqlLimit('abc')).toThrow(/not a whole number/)
  })
})
