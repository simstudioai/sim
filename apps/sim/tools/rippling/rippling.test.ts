import { describe, expect, it } from 'vitest'
import { ripplingCreateCustomObjectRecordTool } from '@/tools/rippling/create_custom_object_record'
import { ripplingCreateDraftHiresTool } from '@/tools/rippling/create_draft_hires'
import { ripplingGetCustomObjectFieldTool } from '@/tools/rippling/get_custom_object_field'
import { ripplingListCustomObjectRecordsTool } from '@/tools/rippling/list_custom_object_records'
import { ripplingUpdateCustomObjectRecordTool } from '@/tools/rippling/update_custom_object_record'
import type { ToolConfig } from '@/tools/types'

function requestBody<P>(tool: ToolConfig<P>, params: P): unknown {
  const body = tool.request.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no body builder`)
  return body(params)
}

function requestUrl<P>(tool: ToolConfig<P>, params: P): string {
  const { url } = tool.request
  return typeof url === 'function' ? url(params) : url
}

describe('Rippling custom object record bodies', () => {
  it('sends record fields at the top level on create', () => {
    const body = requestBody(ripplingCreateCustomObjectRecordTool, {
      apiKey: 'key',
      customObjectApiName: 'licenses_1__c',
      externalId: 'license_4',
      data: { name: 'License 4', owner_role: 'role_1' },
    })
    expect(body).toEqual({ name: 'License 4', owner_role: 'role_1', external_id: 'license_4' })
  })

  it('sends record fields at the top level on update', () => {
    const body = requestBody(ripplingUpdateCustomObjectRecordTool, {
      apiKey: 'key',
      customObjectApiName: 'licenses_1__c',
      codrId: 'rec_1',
      data: { status__c: 'FINAL' },
    })
    expect(body).toEqual({ status__c: 'FINAL' })
  })

  it('parses record fields a model sent as a JSON string', () => {
    const body = requestBody(ripplingCreateCustomObjectRecordTool, {
      apiKey: 'key',
      customObjectApiName: 'licenses_1__c',
      data: '{"name": "License 4"}',
    })
    expect(body).toEqual({ name: 'License 4' })
  })

  it.each([
    ['malformed JSON', '{"status__c": '],
    ['a JSON array', '[{"status__c": "FINAL"}]'],
    ['an array', [{ status__c: 'FINAL' }]],
  ])('rejects %s instead of sending an empty update', (_label, data) => {
    expect(() =>
      requestBody(ripplingUpdateCustomObjectRecordTool, {
        apiKey: 'key',
        customObjectApiName: 'licenses_1__c',
        codrId: 'rec_1',
        data: data,
      })
    ).toThrow(/data must be a JSON object/)
  })

  it('rejects create data that is not an object instead of creating an empty record', () => {
    expect(() =>
      requestBody(ripplingCreateCustomObjectRecordTool, {
        apiKey: 'key',
        customObjectApiName: 'licenses_1__c',
        externalId: 'license_4',
        data: 'License 4',
      })
    ).toThrow(/data must be a JSON object/)
  })

  it('sends only external_id when an update omits data', () => {
    const body = requestBody(ripplingUpdateCustomObjectRecordTool, {
      apiKey: 'key',
      customObjectApiName: 'licenses_1__c',
      codrId: 'rec_1',
      externalId: 'license_4',
    })
    expect(body).toEqual({ external_id: 'license_4' })
  })
})

describe('Rippling draft hires body', () => {
  it('does not double-wrap a payload already keyed by draft_hires', () => {
    const hires = [{ personal_info: { name: { first: 'Ada', last: 'L' } } }]
    const body = requestBody(ripplingCreateDraftHiresTool, {
      apiKey: 'key',
      draftHires: { draft_hires: hires },
    })
    expect(body).toEqual({ draft_hires: hires })
  })
})

describe('Rippling path segments', () => {
  it('rejects a traversal segment instead of addressing another endpoint', () => {
    expect(() =>
      requestUrl(ripplingGetCustomObjectFieldTool, {
        apiKey: 'key',
        customObjectApiName: '..',
        fieldApiName: 'status__c',
      })
    ).toThrow(/path traversal/)
  })
})

describe('Rippling list pagination', () => {
  it('pages custom object records with the cursor parsed from next_link', async () => {
    const url = requestUrl(ripplingListCustomObjectRecordsTool, {
      apiKey: 'key',
      customObjectApiName: 'pet__c',
      cursor: 'cD0x=',
    })
    expect(url).toBe('https://rest.ripplingapis.com/custom-objects/pet__c/records/?cursor=cD0x%3D')

    const response = new Response(
      JSON.stringify({
        results: [],
        next_link: 'https://rest.ripplingapis.com/custom-objects/pet__c/records/?cursor=cD0y%3D',
      })
    )
    const result = await ripplingListCustomObjectRecordsTool.transformResponse?.(response)
    expect(result?.output.nextCursor).toBe('cD0y=')
  })
})
