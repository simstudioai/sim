/**
 * @vitest-environment node
 *
 * Guards the invariants of the shared `utils.ts` refactor: the eight
 * pre-existing generic Table API tools must keep their original wire behavior,
 * and the semantic tools must default `sysparm_display_value` to `all` without
 * leaking that default onto the generic ones.
 */
import { describe, expect, it } from 'vitest'
import { ServiceNowBlock } from '@/blocks/blocks/servicenow'
import { aggregateTool } from '@/tools/servicenow/aggregate'
import { DEFAULT_DISPLAY_VALUE } from '@/tools/servicenow/constants'
import { createIncidentTool } from '@/tools/servicenow/create_incident'
import { createRecordTool } from '@/tools/servicenow/create_record'
import { deleteRecordTool } from '@/tools/servicenow/delete_record'
import { downloadAttachmentTool } from '@/tools/servicenow/download_attachment'
import { getIncidentTool } from '@/tools/servicenow/get_incident'
import { listAttachmentsTool } from '@/tools/servicenow/list_attachments'
import { listIncidentsTool } from '@/tools/servicenow/list_incidents'
import { readRecordTool } from '@/tools/servicenow/read_record'
import { updateIncidentTool } from '@/tools/servicenow/update_incident'
import { updateRecordTool } from '@/tools/servicenow/update_record'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const auth = {
  instanceUrl: 'https://example.service-now.com',
  username: 'svc.user',
  password: PLACEHOLDER_PASSWORD,
}

const EXPECTED_BASIC = `Basic ${Buffer.from(`svc.user:${PLACEHOLDER_PASSWORD}`).toString('base64')}`

function urlOf(tool: { request: { url: (p: never) => string } }, params: unknown): URL {
  return new URL(tool.request.url(params as never))
}

function headersOf(tool: { request: { headers?: (p: never) => Record<string, string> } }, params: unknown) {
  return tool.request.headers?.(params as never) ?? {}
}

describe('ServiceNow shared request helpers', () => {
  it('normalizes the instance URL by trimming whitespace and a trailing slash', () => {
    const url = urlOf(readRecordTool, {
      ...auth,
      instanceUrl: '  https://example.service-now.com/  ',
      tableName: 'incident',
    })
    expect(url.origin).toBe('https://example.service-now.com')
    expect(url.pathname).toBe('/api/now/table/incident')
  })

  it('throws the original message when the instance URL is blank', () => {
    expect(() => urlOf(readRecordTool, { ...auth, instanceUrl: '   ', tableName: 'incident' })).toThrow(
      'ServiceNow instance URL is required'
    )
  })

  it('throws the original message when credentials are missing', () => {
    expect(() => headersOf(readRecordTool, { ...auth, password: '', tableName: 'incident' })).toThrow(
      'ServiceNow username and password are required'
    )
  })
})

describe('pre-existing generic Table API tools keep their original wire behavior', () => {
  it('create_record posts to the table collection with JSON headers', () => {
    const params = { ...auth, tableName: 'incident', fields: { short_description: 'x' } }
    expect(urlOf(createRecordTool, params).pathname).toBe('/api/now/table/incident')
    expect(createRecordTool.request.method).toBe('POST')
    expect(headersOf(createRecordTool, params)).toEqual({
      Authorization: EXPECTED_BASIC,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    })
  })

  it('update_record patches the record URL with JSON headers', () => {
    const params = { ...auth, tableName: 'incident', sysId: ' abc123 ', fields: { state: '2' } }
    expect(urlOf(updateRecordTool, params).pathname).toBe('/api/now/table/incident/abc123')
    expect(updateRecordTool.request.method).toBe('PATCH')
    expect(headersOf(updateRecordTool, params)['Content-Type']).toBe('application/json')
  })

  it('delete_record targets the record URL without a Content-Type', () => {
    const params = { ...auth, tableName: 'incident', sysId: 'abc123' }
    expect(urlOf(deleteRecordTool, params).pathname).toBe('/api/now/table/incident/abc123')
    expect(deleteRecordTool.request.method).toBe('DELETE')
    expect(headersOf(deleteRecordTool, params)).toEqual({
      Authorization: EXPECTED_BASIC,
      Accept: 'application/json',
    })
  })

  it('aggregate targets the stats endpoint', () => {
    const params = { ...auth, tableName: 'incident', count: true }
    expect(urlOf(aggregateTool, params).pathname).toBe('/api/now/stats/incident')
    expect(headersOf(aggregateTool, params)).toEqual({
      Authorization: EXPECTED_BASIC,
      Accept: 'application/json',
    })
  })

  it('list_attachments filters by table and record sys_id', () => {
    const url = urlOf(listAttachmentsTool, { ...auth, tableName: 'incident', recordSysId: 'rec1' })
    expect(url.pathname).toBe('/api/now/attachment')
    expect(url.searchParams.get('sysparm_query')).toBe('table_name=incident^table_sys_id=rec1')
  })

  it('download_attachment keeps its wildcard Accept header', () => {
    const params = { ...auth, attachmentSysId: 'att1' }
    expect(urlOf(downloadAttachmentTool, params).pathname).toBe('/api/now/attachment/att1/file')
    expect(headersOf(downloadAttachmentTool, params)).toEqual({
      Authorization: EXPECTED_BASIC,
      Accept: '*/*',
    })
  })
})

describe('sysparm_display_value separation', () => {
  it('read_record omits sysparm_display_value unless the caller sets one', () => {
    const url = urlOf(readRecordTool, { ...auth, tableName: 'incident' })
    expect(url.searchParams.has('sysparm_display_value')).toBe(false)
  })

  it('read_record still forwards an explicit display value', () => {
    const url = urlOf(readRecordTool, { ...auth, tableName: 'incident', displayValue: 'true' })
    expect(url.searchParams.get('sysparm_display_value')).toBe('true')
  })

  it('aggregate omits sysparm_display_value unless the caller sets one', () => {
    const url = urlOf(aggregateTool, { ...auth, tableName: 'incident', count: true })
    expect(url.searchParams.has('sysparm_display_value')).toBe(false)
  })

  it('semantic reads default to all', () => {
    expect(urlOf(listIncidentsTool, auth).searchParams.get('sysparm_display_value')).toBe(
      DEFAULT_DISPLAY_VALUE
    )
    expect(
      urlOf(getIncidentTool, { ...auth, number: 'INC0010001' }).searchParams.get(
        'sysparm_display_value'
      )
    ).toBe(DEFAULT_DISPLAY_VALUE)
  })

  it('semantic writes default to all and omit sysparm_input_display_value', () => {
    const url = urlOf(createIncidentTool, { ...auth, shortDescription: 'x' })
    expect(url.searchParams.get('sysparm_display_value')).toBe(DEFAULT_DISPLAY_VALUE)
    expect(url.searchParams.has('sysparm_input_display_value')).toBe(false)
  })

  it('semantic writes surface sysparm_input_display_value when enabled', () => {
    const url = urlOf(createIncidentTool, {
      ...auth,
      shortDescription: 'x',
      inputDisplayValue: true,
    })
    expect(url.searchParams.get('sysparm_input_display_value')).toBe('true')
  })
})

describe('block params mapping keeps per-operation defaults from colliding', () => {
  const mapParams = ServiceNowBlock.tools.config?.params

  /**
   * Every subBlock default is seeded by id, so two subBlocks sharing an id
   * would leave a single stored value that the last definition wins.
   */
  function seededDefaults(): Record<string, unknown> {
    const seeded: Record<string, unknown> = {}
    for (const subBlock of ServiceNowBlock.subBlocks) {
      if (typeof subBlock.value === 'function') {
        seeded[subBlock.id] = (subBlock.value as (p: Record<string, never>) => unknown)({})
      }
    }
    return seeded
  }

  it('does not leak the semantic "all" default onto the generic Table API tools', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_read_record',
      tableName: 'incident',
    } as never) as Record<string, unknown>

    expect(mapped.displayValue).toBeFalsy()
  })

  it('does not leak the semantic "all" default onto aggregate', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_aggregate',
      tableName: 'incident',
    } as never) as Record<string, unknown>

    expect(mapped.displayValue).toBeFalsy()
  })

  it('applies the semantic "all" default on a semantic operation', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_list_incidents',
    } as never) as Record<string, unknown>

    expect(mapped.displayValue).toBe(DEFAULT_DISPLAY_VALUE)
  })

  it('does not leak the approval state default onto incident creation', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_create_incident',
      shortDescription: 'x',
    } as never) as Record<string, unknown>

    expect(mapped.state).toBeFalsy()
  })

  it('routes the approval state control to state for list approvals', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_list_approvals',
    } as never) as Record<string, unknown>

    expect(mapped.state).toBe('requested')
  })

  it('routes the target state control to state for a change transition', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_update_change_state',
      sysId: 'chg1',
    } as never) as Record<string, unknown>

    expect(mapped.state).toBe('-5')
  })
})

describe('write tools require a sys_id rather than a record number', () => {
  it('tells the caller to resolve the number first', () => {
    expect(updateIncidentTool.params.sysId?.required).toBe(true)
    expect(updateIncidentTool.params.sysId?.description).toMatch(/record number/i)
  })
})
