/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildCreateRecordUrl,
  buildDeleteRecordUrl,
  buildLockRecordUrl,
  buildReadRecordUrl,
  buildRunActionButtonUrl,
  buildSearchRecordsUrl,
  buildUpdateRecordUrl,
} from '@/tools/agiloft/utils'

const BASE = 'https://example.agiloft.com'

const baseParams = {
  instanceUrl: BASE,
  knowledgeBase: 'Demo',
  login: 'admin',
  password: 'secret',
  table: 'helpdesk_case',
}

describe('CRUD endpoints', () => {
  it('targets the documented EW* operations rather than the /ewws/REST path', () => {
    expect(buildCreateRecordUrl(BASE, baseParams, {})).toContain('/ewws/EWCreate?')
    expect(buildReadRecordUrl(BASE, { ...baseParams, recordId: '358' })).toContain('/ewws/EWRead?')
    expect(buildUpdateRecordUrl(BASE, { ...baseParams, recordId: '358' }, {})).toContain(
      '/ewws/EWUpdate?'
    )
    expect(buildDeleteRecordUrl(BASE, { ...baseParams, recordId: '358' })).toContain(
      '/ewws/EWDelete?'
    )
  })

  it('passes record data as the &field=value pairs EWCreate reads off the query string', () => {
    const url = buildCreateRecordUrl(BASE, baseParams, {
      first_name: 'John',
      last_name: 'Doe',
    })

    expect(url).toContain('&first_name=John')
    expect(url).toContain('&last_name=Doe')
  })

  it('percent-encodes field names and values so separators cannot be injected', () => {
    const url = buildCreateRecordUrl(BASE, baseParams, {
      summary: "Acme & Co: 100% 'done'",
    })

    expect(url).toContain("&summary=Acme%20%26%20Co%3A%20100%25%20'done'")
    expect(url).not.toContain('Acme & Co')
  })

  it('skips null and undefined field values instead of sending the literal text', () => {
    const url = buildCreateRecordUrl(BASE, baseParams, {
      keep: 'yes',
      skipNull: null,
      skipUndefined: undefined,
    })

    expect(url).toContain('&keep=yes')
    expect(url).not.toContain('skipNull')
    expect(url).not.toContain('skipUndefined')
  })

  it('always sends a delete rule, defaulting to the non-cascading one', () => {
    expect(buildDeleteRecordUrl(BASE, { ...baseParams, recordId: '358' })).toContain(
      '&deleteRule=ERROR_IF_DEPENDANTS'
    )
    expect(
      buildDeleteRecordUrl(BASE, {
        ...baseParams,
        recordId: '358',
        deleteRule: 'APPLY_UNLINK',
      })
    ).toContain('&deleteRule=APPLY_UNLINK')
  })

  it('does not ask for the .json variant on operations whose JSON shape is undocumented', () => {
    expect(buildSearchRecordsUrl(BASE, { ...baseParams, query: "a='b'" })).not.toContain('.json')
    expect(
      buildLockRecordUrl(BASE, { ...baseParams, recordId: '18', lockAction: 'check' })
    ).not.toContain('.json')
  })
})

describe('buildRunActionButtonUrl', () => {
  it('uses the /ewws/async prefix EWActionButton is documented under', () => {
    const url = buildRunActionButtonUrl(BASE, {
      ...baseParams,
      recordId: '82',
      actionButtonField: 'ab_field',
    })

    expect(url).toContain('/ewws/async/EWActionButton?')
    expect(url).toContain('&name=ab_field')
    expect(url).toContain('&id=82')
  })
})

describe('buildSearchRecordsUrl', () => {
  it('sends the saved search label as the documented "search" parameter', () => {
    const url = buildSearchRecordsUrl(BASE, {
      ...baseParams,
      search: 'C: Status is Closed',
    })

    expect(url).toContain('&search=C%3A%20Status%20is%20Closed')
    expect(url).not.toContain('query=')
  })

  it('combines a saved search with an ad hoc query, as EWSearch allows', () => {
    const url = buildSearchRecordsUrl(BASE, {
      ...baseParams,
      search: 'C: Status is Closed',
      query: "priority='High'",
    })

    expect(url).toContain('&search=C%3A%20Status%20is%20Closed')
    expect(url).toContain("&query=priority%3D'High'")
  })

  it('omits the query parameter entirely when no query is supplied', () => {
    const url = buildSearchRecordsUrl(BASE, { ...baseParams, search: 'All Open' })

    expect(url).not.toMatch(/[?&]query=/)
  })
})

describe('buildLockRecordUrl', () => {
  it('adds force only on unlock, where EWLock accepts it', () => {
    const unlock = buildLockRecordUrl(BASE, {
      ...baseParams,
      recordId: '18',
      lockAction: 'unlock',
      force: true,
    })

    expect(unlock).toContain('&force=true')
  })

  it('never sends force on lock or status checks', () => {
    for (const lockAction of ['lock', 'check'] as const) {
      const url = buildLockRecordUrl(BASE, {
        ...baseParams,
        recordId: '18',
        lockAction,
        force: true,
      })

      expect(url).not.toContain('force')
    }
  })
})
