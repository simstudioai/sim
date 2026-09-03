/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/tools/registry')

import { normalizeEloquaInstanceUrl } from '@/lib/oauth/eloqua'
import { EloquaBlock } from '@/blocks/blocks/eloqua'
import * as eloquaToolExports from '@/tools/eloqua'
import {
  eloquaActivateCampaignTool,
  eloquaCreateContactExportTool,
  eloquaCreateContactImportTool,
  eloquaGetBulkSyncDataTool,
  eloquaGetBulkSyncTool,
  eloquaListContactsTool,
  eloquaStartBulkSyncTool,
  eloquaUpdateContactTool,
  eloquaUploadContactImportDataTool,
} from '@/tools/eloqua'
import { tools } from '@/tools/registry'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const INSTANCE_URL = 'https://secure.p03.eloqua.com'
const AUTH = { accessToken: 'access-token', instanceUrl: INSTANCE_URL }

const CONTRACTS = [
  ['eloqua_list_contacts', 'GET', '/api/rest/1.0/data/contacts'],
  ['eloqua_get_contact', 'GET', '/api/rest/1.0/data/contact/123'],
  ['eloqua_create_contact', 'POST', '/api/rest/1.0/data/contact'],
  ['eloqua_update_contact', 'PUT', '/api/rest/1.0/data/contact/123'],
  ['eloqua_list_accounts', 'GET', '/api/rest/1.0/data/accounts'],
  ['eloqua_get_account', 'GET', '/api/rest/1.0/data/account/123'],
  ['eloqua_create_account', 'POST', '/api/rest/1.0/data/account'],
  ['eloqua_update_account', 'PUT', '/api/rest/1.0/data/account/123'],
  ['eloqua_list_campaigns', 'GET', '/api/rest/2.0/assets/campaigns'],
  ['eloqua_get_campaign', 'GET', '/api/rest/2.0/assets/campaign/123'],
  ['eloqua_activate_campaign', 'POST', '/api/rest/2.0/assets/campaign/active/123'],
  ['eloqua_deactivate_campaign', 'POST', '/api/rest/2.0/assets/campaign/draft/123'],
  ['eloqua_list_contact_lists', 'GET', '/api/rest/1.0/assets/contact/lists'],
  ['eloqua_get_contact_list', 'GET', '/api/rest/1.0/assets/contact/list/123'],
  ['eloqua_list_segments', 'GET', '/api/rest/2.0/assets/contact/segments'],
  ['eloqua_get_segment', 'GET', '/api/rest/2.0/assets/contact/segment/123'],
  ['eloqua_list_emails', 'GET', '/api/rest/2.0/assets/emails'],
  ['eloqua_get_email', 'GET', '/api/rest/2.0/assets/email/123'],
  ['eloqua_list_forms', 'GET', '/api/rest/2.0/assets/forms'],
  ['eloqua_get_form', 'GET', '/api/rest/2.0/assets/form/123'],
  ['eloqua_list_contact_fields', 'GET', '/api/bulk/2.0/contacts/fields'],
  ['eloqua_create_contact_import', 'POST', '/api/bulk/2.0/contacts/imports'],
  ['eloqua_upload_contact_import_data', 'POST', '/api/bulk/2.0/contacts/imports/123/data'],
  ['eloqua_create_contact_export', 'POST', '/api/bulk/2.0/contacts/exports'],
  ['eloqua_list_bulk_syncs', 'GET', '/api/bulk/2.0/syncs'],
  ['eloqua_start_bulk_sync', 'POST', '/api/bulk/2.0/syncs'],
  ['eloqua_get_bulk_sync', 'GET', '/api/bulk/2.0/syncs/123'],
  ['eloqua_get_bulk_sync_data', 'GET', '/api/bulk/2.0/syncs/123/data'],
  ['eloqua_get_bulk_sync_logs', 'GET', '/api/bulk/2.0/syncs/123/logs'],
  ['eloqua_get_bulk_sync_rejects', 'GET', '/api/bulk/2.0/syncs/123/rejects'],
] as const

type EloquaToolId = (typeof CONTRACTS)[number][0]

const APPLICATION_LIST_IDS = new Set<EloquaToolId>([
  'eloqua_list_contacts',
  'eloqua_list_accounts',
  'eloqua_list_campaigns',
  'eloqua_list_contact_lists',
  'eloqua_list_segments',
  'eloqua_list_emails',
  'eloqua_list_forms',
])

const BULK_PAGE_IDS = new Set<EloquaToolId>([
  'eloqua_list_contact_fields',
  'eloqua_list_bulk_syncs',
  'eloqua_get_bulk_sync_data',
  'eloqua_get_bulk_sync_logs',
  'eloqua_get_bulk_sync_rejects',
])

const EXPECTED_SUCCESS_STATUSES: Record<EloquaToolId, readonly number[]> = {
  eloqua_list_contacts: [200, 204],
  eloqua_get_contact: [200],
  eloqua_create_contact: [201],
  eloqua_update_contact: [200],
  eloqua_list_accounts: [200, 204],
  eloqua_get_account: [200],
  eloqua_create_account: [201],
  eloqua_update_account: [200],
  eloqua_list_campaigns: [200],
  eloqua_get_campaign: [200],
  eloqua_activate_campaign: [201],
  eloqua_deactivate_campaign: [201],
  eloqua_list_contact_lists: [200],
  eloqua_get_contact_list: [200],
  eloqua_list_segments: [200],
  eloqua_get_segment: [200],
  eloqua_list_emails: [200],
  eloqua_get_email: [200],
  eloqua_list_forms: [200],
  eloqua_get_form: [200],
  eloqua_list_contact_fields: [200],
  eloqua_create_contact_import: [201],
  eloqua_upload_contact_import_data: [201, 204],
  eloqua_create_contact_export: [201],
  eloqua_list_bulk_syncs: [200],
  eloqua_start_bulk_sync: [201],
  eloqua_get_bulk_sync: [200],
  eloqua_get_bulk_sync_data: [200],
  eloqua_get_bulk_sync_logs: [200],
  eloqua_get_bulk_sync_rejects: [200],
}

const APPLICATION_LIST_QUERY = {
  depth: 'partial',
  count: '25',
  page: '2',
  search: "name='Example*'",
  orderBy: 'name ASC',
  lastUpdatedAt: '1700000000',
}

const BULK_QUERY = {
  limit: '25',
  offset: '5',
  q: "status='success'",
  orderBy: 'createdAt DESC',
  totalResults: 'true',
}

const EXPECTED_QUERY: Record<EloquaToolId, Record<string, string>> = {
  eloqua_list_contacts: { ...APPLICATION_LIST_QUERY, viewId: '42' },
  eloqua_get_contact: { depth: 'complete', viewId: '42' },
  eloqua_create_contact: {},
  eloqua_update_contact: {},
  eloqua_list_accounts: { ...APPLICATION_LIST_QUERY, viewId: '42', ownedByUserId: '7' },
  eloqua_get_account: { depth: 'complete', viewId: '42' },
  eloqua_create_account: {},
  eloqua_update_account: {},
  eloqua_list_campaigns: {
    ...APPLICATION_LIST_QUERY,
    externalSystemId: '9',
    includeCrmIdsMapping: 'true',
  },
  eloqua_get_campaign: {
    depth: 'complete',
    externalSystemId: '9',
    includeCrmIdsMapping: 'true',
  },
  eloqua_activate_campaign: { scheduledFor: 'now', runAsUserId: '7', activateNow: 'false' },
  eloqua_deactivate_campaign: {},
  eloqua_list_contact_lists: APPLICATION_LIST_QUERY,
  eloqua_get_contact_list: { depth: 'complete' },
  eloqua_list_segments: APPLICATION_LIST_QUERY,
  eloqua_get_segment: { depth: 'complete' },
  eloqua_list_emails: {
    ...APPLICATION_LIST_QUERY,
    includeAvailable: 'true',
    includeArchived: 'false',
  },
  eloqua_get_email: { depth: 'complete', preMerge: 'true', noMergeContent: 'false' },
  eloqua_list_forms: {
    ...APPLICATION_LIST_QUERY,
    includeAvailable: 'true',
    includeArchived: 'false',
  },
  eloqua_get_form: { depth: 'complete' },
  eloqua_list_contact_fields: BULK_QUERY,
  eloqua_create_contact_import: {},
  eloqua_upload_contact_import_data: {},
  eloqua_create_contact_export: {},
  eloqua_list_bulk_syncs: BULK_QUERY,
  eloqua_start_bulk_sync: {},
  eloqua_get_bulk_sync: {},
  eloqua_get_bulk_sync_data: { limit: '25', offset: '5', totalResults: 'true' },
  eloqua_get_bulk_sync_logs: BULK_QUERY,
  eloqua_get_bulk_sync_rejects: BULK_QUERY,
}

function expectedBody(id: EloquaToolId, params: Record<string, unknown>): unknown {
  switch (id) {
    case 'eloqua_create_contact':
    case 'eloqua_update_contact':
    case 'eloqua_create_account':
    case 'eloqua_update_account':
      return params.entity
    case 'eloqua_create_contact_import':
    case 'eloqua_create_contact_export':
      return params.definition
    case 'eloqua_upload_contact_import_data':
      return JSON.stringify(params.data)
    case 'eloqua_start_bulk_sync':
      return { syncedInstanceUri: '/contacts/imports/123' }
    default:
      return undefined
  }
}

function successResponse(id: EloquaToolId, status: number): Response {
  if (status === 204) return new Response(null, { status })
  if (APPLICATION_LIST_IDS.has(id)) {
    return Response.json({ elements: [], page: 1, pageSize: 0, total: 0 }, { status })
  }
  if (BULK_PAGE_IDS.has(id)) {
    return Response.json(
      { items: [], count: 0, hasMore: false, limit: 1000, offset: 0 },
      { status }
    )
  }
  if (id === 'eloqua_get_bulk_sync' || id === 'eloqua_start_bulk_sync') {
    return Response.json({ status: 'success', uri: '/syncs/123' }, { status })
  }
  if (id === 'eloqua_upload_contact_import_data') {
    return Response.json({ status: 'success', uri: '/syncs/123' }, { status })
  }
  if (id === 'eloqua_create_contact_import' || id === 'eloqua_create_contact_export') {
    return Response.json(
      { name: 'Definition', fields: {}, uri: '/contacts/imports/123' },
      { status }
    )
  }
  return Response.json({ type: 'Contact', id: '123' }, { status })
}

function expectedOutputKeys(id: EloquaToolId): string[] {
  if (APPLICATION_LIST_IDS.has(id)) return ['items', 'page', 'pageSize', 'success', 'total', 'type']
  if (BULK_PAGE_IDS.has(id)) {
    return ['count', 'hasMore', 'items', 'limit', 'offset', 'success', 'totalResults']
  }
  if (id === 'eloqua_create_contact_import' || id === 'eloqua_create_contact_export') {
    return ['definition', 'success']
  }
  if (id === 'eloqua_upload_contact_import_data') return ['accepted', 'success', 'sync']
  if (id === 'eloqua_get_bulk_sync' || id === 'eloqua_start_bulk_sync') {
    return ['success', 'sync']
  }
  return ['item', 'success']
}

function importedTools(): ToolConfig[] {
  return Object.values(eloquaToolExports).filter(
    (value): value is ToolConfig =>
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof value.id === 'string' &&
      value.id.startsWith('eloqua_')
  )
}

function toolParams(toolId: string): Record<string, unknown> {
  const params: Record<string, unknown> = { ...AUTH }
  if (APPLICATION_LIST_IDS.has(toolId as EloquaToolId)) {
    Object.assign(params, {
      depth: 'partial',
      count: 25,
      page: 2,
      search: "name='Example*'",
      orderBy: 'name ASC',
      lastUpdatedAt: 1_700_000_000,
    })
  } else if (toolId.startsWith('eloqua_get_') && !toolId.startsWith('eloqua_get_bulk_sync')) {
    params.depth = 'complete'
  }
  if (BULK_PAGE_IDS.has(toolId as EloquaToolId)) {
    Object.assign(params, { limit: 25, offset: 5, totalResults: true })
    if (toolId !== 'eloqua_get_bulk_sync_data') {
      Object.assign(params, { q: "status='success'", orderBy: 'createdAt DESC' })
    }
  }
  if (
    toolId.startsWith('eloqua_get_') ||
    toolId.startsWith('eloqua_update_') ||
    toolId === 'eloqua_activate_campaign' ||
    toolId === 'eloqua_deactivate_campaign' ||
    toolId === 'eloqua_upload_contact_import_data'
  ) {
    params.id = '123'
  }
  if (toolId === 'eloqua_create_contact' || toolId === 'eloqua_update_contact') {
    params.entity = { type: 'Contact', emailAddress: 'person@example.com' }
  }
  if (toolId === 'eloqua_list_contacts' || toolId === 'eloqua_get_contact') params.viewId = 42
  if (toolId === 'eloqua_list_accounts' || toolId === 'eloqua_get_account') params.viewId = 42
  if (toolId === 'eloqua_list_accounts') params.ownedByUserId = 7
  if (toolId === 'eloqua_list_campaigns' || toolId === 'eloqua_get_campaign') {
    params.externalSystemId = 9
    params.includeCrmIdsMapping = true
  }
  if (toolId === 'eloqua_list_emails' || toolId === 'eloqua_list_forms') {
    params.includeAvailable = true
    params.includeArchived = false
  }
  if (toolId === 'eloqua_get_email') {
    params.preMerge = true
    params.noMergeContent = false
  }
  if (toolId === 'eloqua_activate_campaign') {
    params.scheduledFor = 'now'
    params.runAsUserId = 7
    params.activateNow = false
  }
  if (toolId === 'eloqua_create_account' || toolId === 'eloqua_update_account') {
    params.entity = { type: 'Account', name: 'Example' }
  }
  if (toolId === 'eloqua_create_contact_import') {
    params.definition = { name: 'Import', fields: { Email: '{{Contact.Field(C_EmailAddress)}}' } }
  }
  if (toolId === 'eloqua_create_contact_export') {
    params.definition = { name: 'Export', fields: { Email: '{{Contact.Field(C_EmailAddress)}}' } }
  }
  if (toolId === 'eloqua_upload_contact_import_data') {
    params.data = [{ Email: 'person@example.com' }]
  }
  if (toolId === 'eloqua_start_bulk_sync') {
    params.syncedInstanceUri = '/contacts/imports/123'
  }
  return params
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): URL {
  if (typeof tool.request.url !== 'function') throw new Error(`${tool.id} must use a URL formatter`)
  return new URL(tool.request.url(params))
}

function requestMethod(tool: ToolConfig, params: Record<string, unknown>): string {
  return typeof tool.request.method === 'function'
    ? tool.request.method(params)
    : tool.request.method
}

async function transform(
  tool: ToolConfig,
  response: Response,
  params: Record<string, unknown> = AUTH
): Promise<ToolResponse> {
  if (!tool.transformResponse) throw new Error(`${tool.id} must transform its response`)
  return tool.transformResponse(response, params)
}

describe('Oracle Eloqua tool contracts', () => {
  it('exports and registers exactly the agreed 30 tools with block parity', () => {
    const imported = importedTools()
    const expectedIds = CONTRACTS.map(([id]) => id)
    expect(imported.map((tool) => tool.id).sort()).toEqual([...expectedIds].sort())
    expect(EloquaBlock.tools.access).toEqual(expectedIds)
    for (const id of expectedIds) expect(tools[id]?.id).toBe(id)

    const operationOptions =
      EloquaBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')?.options ?? []
    expect(operationOptions.map((option) => `eloqua_${String(option.id)}`)).toEqual(expectedIds)
  })

  it.each(CONTRACTS)('%s uses %s %s', (id, method, path) => {
    const tool = tools[id]
    const params = toolParams(id)
    expect(requestMethod(tool, params)).toBe(method)
    const url = requestUrl(tool, params)
    expect(url.pathname).toBe(path)
    expect(Object.fromEntries(url.searchParams)).toEqual(EXPECTED_QUERY[id])
    expect(tool.oauth).toEqual({
      required: true,
      provider: 'eloqua',
      authoritativeParams: ['instanceUrl'],
    })
    expect(tool.params.accessToken).toMatchObject({ required: true, visibility: 'hidden' })
    expect(tool.params.instanceUrl).toMatchObject({ required: true, visibility: 'hidden' })
    expect(tool.request.body?.(params)).toEqual(expectedBody(id, params))
    expect(tool.request.retry).toBeUndefined()
    expect(Object.keys(tool.outputs ?? {}).sort()).toEqual(expectedOutputKeys(id))
  })

  it.each(CONTRACTS)('%s enforces its documented success statuses and transform', async (id) => {
    const tool = tools[id]
    const params = toolParams(id)
    for (const status of EXPECTED_SUCCESS_STATUSES[id]) {
      await expect(transform(tool, successResponse(id, status), params)).resolves.toMatchObject({
        success: true,
        output: { success: true },
      })
    }

    const wrongStatus = EXPECTED_SUCCESS_STATUSES[id].includes(202) ? 418 : 202
    await expect(
      transform(tool, new Response(null, { status: wrongStatus }), params)
    ).rejects.toThrow('expected HTTP')
  })

  it('serializes Application pagination and search without accumulating pages', () => {
    const url = requestUrl(eloquaListContactsTool, {
      ...AUTH,
      depth: 'minimal',
      count: 100,
      page: 3,
      search: "name='O''Brien*'",
      orderBy: 'name ASC',
      lastUpdatedAt: 1_700_000_000,
      viewId: 42,
    })
    expect(Object.fromEntries(url.searchParams)).toEqual({
      depth: 'minimal',
      count: '100',
      page: '3',
      search: "name='O''Brien*'",
      orderBy: 'name ASC',
      lastUpdatedAt: '1700000000',
      viewId: '42',
    })
    expect(eloquaListContactsTool.request.retry).toBeUndefined()
  })

  it('normalizes an Application 204 list response to one empty page', async () => {
    await expect(
      transform(eloquaListContactsTool, new Response(null, { status: 204 }), {
        ...AUTH,
        page: 4,
      })
    ).resolves.toEqual({
      success: true,
      output: { items: [], page: 4, pageSize: 0, total: 0, type: null, success: true },
    })
  })

  it('passes through a complete contact representation for PUT and declares no retry', () => {
    const params = {
      ...AUTH,
      id: '123',
      entity: { type: 'Contact', id: '123', emailAddress: 'person@example.com' },
    }
    expect(eloquaUpdateContactTool.request.body?.(params)).toEqual(params.entity)
    expect(eloquaUpdateContactTool.request.retry).toBeUndefined()
    expect(eloquaUpdateContactTool.description).toContain('complete contact representation')
  })

  it('accepts the documented 201 campaign activation response', async () => {
    await expect(
      transform(
        eloquaActivateCampaignTool,
        Response.json({ type: 'Campaign', id: '123', currentStatus: 'Active' }, { status: 201 }),
        { ...AUTH, id: '123' }
      )
    ).resolves.toMatchObject({
      success: true,
      output: { item: { id: '123', currentStatus: 'Active' }, success: true },
    })
  })

  it('serializes both documented campaign activation schedule forms', () => {
    const immediate = requestUrl(eloquaActivateCampaignTool, {
      ...AUTH,
      id: '123',
      scheduledFor: 'now',
    })
    const scheduled = requestUrl(eloquaActivateCampaignTool, {
      ...AUTH,
      id: '123',
      scheduledFor: '1700000000',
    })
    expect(immediate.searchParams.get('scheduledFor')).toBe('now')
    expect(scheduled.searchParams.get('scheduledFor')).toBe('1700000000')
    expect(() =>
      requestUrl(eloquaActivateCampaignTool, { ...AUTH, id: '123', scheduledFor: 'tomorrow' })
    ).toThrow('Unix timestamp or the literal "now"')
  })

  it.each([
    ['eloqua_list_contact_fields', 1_000],
    ['eloqua_list_bulk_syncs', 1_000],
    ['eloqua_get_bulk_sync_data', 50_000],
    ['eloqua_get_bulk_sync_logs', 1_000],
    ['eloqua_get_bulk_sync_rejects', 1_000],
  ] as const)('%s enforces its documented maximum page size', (id, maximum) => {
    const tool = tools[id]
    expect(() => requestUrl(tool, { ...toolParams(id), limit: maximum })).not.toThrow()
    expect(() => requestUrl(tool, { ...toolParams(id), limit: maximum + 1 })).toThrow(
      `1 to ${maximum}`
    )
  })

  it('types stable Application and Bulk items while preserving only sync data as dynamic', () => {
    for (const id of APPLICATION_LIST_IDS) {
      const item = tools[id].outputs?.items.items
      expect(Object.keys(item?.properties ?? {}).length, id).toBeGreaterThan(10)
    }
    for (const id of [
      'eloqua_list_contact_fields',
      'eloqua_list_bulk_syncs',
      'eloqua_get_bulk_sync_logs',
      'eloqua_get_bulk_sync_rejects',
    ] as const) {
      expect(
        Object.keys(tools[id].outputs?.items.items?.properties ?? {}).length,
        id
      ).toBeGreaterThan(4)
    }
    expect(tools.eloqua_get_bulk_sync_data.outputs?.items.items?.properties).toBeUndefined()
    expect(
      tools.eloqua_get_bulk_sync_rejects.outputs?.items.items?.properties?.invalidFields.items?.type
    ).toBe('string')

    const importProperties = tools.eloqua_create_contact_import.outputs?.definition.properties ?? {}
    const exportProperties = tools.eloqua_create_contact_export.outputs?.definition.properties ?? {}
    expect(importProperties).toHaveProperty('importRule')
    expect(importProperties).toHaveProperty('updateRuleByField')
    expect(importProperties).not.toHaveProperty('filter')
    expect(exportProperties).toHaveProperty('filter')
    expect(exportProperties).toHaveProperty('areSystemTimestampsInUTC')
    expect(exportProperties).not.toHaveProperty('importRule')
  })

  it('serializes Bulk definitions and an explicit sync lifecycle', () => {
    const definition = { name: 'Import', fields: { Email: '{{Contact.Field(C_EmailAddress)}}' } }
    expect(eloquaCreateContactImportTool.request.body?.({ ...AUTH, definition })).toEqual(
      definition
    )
    expect(
      eloquaStartBulkSyncTool.request.body?.({
        ...AUTH,
        syncedInstanceUri: '/contacts/imports/123',
        callbackUrl: 'https://example.com/eloqua/callback',
      })
    ).toEqual({
      syncedInstanceUri: '/contacts/imports/123',
      callbackUrl: 'https://example.com/eloqua/callback',
    })
    expect(eloquaStartBulkSyncTool.request.retry).toBeUndefined()
  })

  it('enforces the documented Bulk definition field limits', () => {
    const fields = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `Field${index}`,
          `{{Contact.Field(C_Field${index})}}`,
        ])
      )

    expect(() =>
      eloquaCreateContactImportTool.request.body?.({
        ...AUTH,
        definition: { fields: fields(100) },
      })
    ).not.toThrow()
    expect(() =>
      eloquaCreateContactImportTool.request.body?.({ ...AUTH, definition: { fields: {} } })
    ).toThrow('1 to 100 field aliases')
    expect(() =>
      eloquaCreateContactImportTool.request.body?.({
        ...AUTH,
        definition: { fields: fields(101) },
      })
    ).toThrow('1 to 100 field aliases')

    expect(() =>
      eloquaCreateContactExportTool.request.body?.({
        ...AUTH,
        definition: { fields: fields(250) },
      })
    ).not.toThrow()
    expect(() =>
      eloquaCreateContactExportTool.request.body?.({
        ...AUTH,
        definition: { fields: fields(251) },
      })
    ).toThrow('1 to 250 field aliases')
    expect(() =>
      eloquaCreateContactImportTool.request.body?.({
        ...AUTH,
        definition: { fields: [] as unknown as Record<string, string> },
      })
    ).toThrow('definition.fields must be a JSON object')
    expect(() =>
      eloquaCreateContactImportTool.request.body?.({
        ...AUTH,
        definition: { fields: { Email: 42 as unknown as string } },
      })
    ).toThrow('must map non-empty aliases to string statements')
  })

  it.each([
    ['eloqua_list_contacts', 'viewId'],
    ['eloqua_get_contact', 'viewId'],
    ['eloqua_list_accounts', 'viewId'],
    ['eloqua_list_accounts', 'ownedByUserId'],
    ['eloqua_get_account', 'viewId'],
    ['eloqua_list_campaigns', 'externalSystemId'],
    ['eloqua_get_campaign', 'externalSystemId'],
    ['eloqua_activate_campaign', 'runAsUserId'],
  ] as const)('%s validates %s as a positive safe integer', (id, field) => {
    for (const invalid of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => requestUrl(tools[id], { ...toolParams(id), [field]: invalid })).toThrow(
        'must be a positive integer'
      )
    }
  })

  it('keeps selector-backed asset targets core in basic and advanced canvas modes', () => {
    const sentences = EloquaBlock.canvasPresentation?.sentences.byOperation
    expect(sentences).toMatchObject({
      get_campaign: [{ field: ['campaignSelector', 'campaignIdInput'], core: true }],
      activate_campaign: [{ field: ['campaignSelector', 'campaignIdInput'], core: true }],
      deactivate_campaign: [{ field: ['campaignSelector', 'campaignIdInput'], core: true }],
      get_contact_list: [{ field: ['contactListSelector', 'contactListIdInput'], core: true }],
      get_segment: [{ field: ['segmentSelector', 'segmentIdInput'], core: true }],
      get_email: [{ field: ['emailSelector', 'emailIdInput'], core: true }],
      get_form: [{ field: ['formSelector', 'formIdInput'], core: true }],
    })
  })

  it('handles a 204 import upload and enforces the 10 MiB inline ceiling', async () => {
    await expect(
      transform(eloquaUploadContactImportDataTool, new Response(null, { status: 204 }), {
        ...AUTH,
        id: '123',
        data: [{ Email: 'person@example.com' }],
      })
    ).resolves.toEqual({
      success: true,
      output: { accepted: true, sync: null, success: true },
    })

    expect(() =>
      eloquaUploadContactImportDataTool.request.body?.({
        ...AUTH,
        id: '123',
        data: [{ oversized: 'x'.repeat(10 * 1024 * 1024) }],
      })
    ).toThrow("Sim's 10 MiB request limit")
  })

  it('preserves dynamic Bulk aliases and validates the documented sync status union', async () => {
    await expect(
      transform(
        eloquaGetBulkSyncDataTool,
        Response.json({
          items: [{ Email: 'person@example.com', Account: 'Example' }],
          count: 1,
          hasMore: false,
          limit: 1000,
          offset: 0,
          totalResults: 1,
        })
      )
    ).resolves.toMatchObject({
      output: { items: [{ Email: 'person@example.com', Account: 'Example' }] },
    })

    await expect(
      transform(eloquaGetBulkSyncTool, Response.json({ status: 'unknown', uri: '/syncs/123' }), {
        ...AUTH,
        id: '123',
      })
    ).rejects.toThrow('pending, active, success, warning, or error')
  })

  it('rejects caller-controlled or unsupported destinations before request dispatch', () => {
    expect(() => normalizeEloquaInstanceUrl('https://evil.example')).toThrow()
    expect(() =>
      requestUrl(eloquaListContactsTool, {
        ...AUTH,
        instanceUrl: 'https://secure.p03.eloqua.com.evil.example',
      })
    ).toThrow()
  })
})
