import type { RipplingCreateCustomObjectRecordParams } from '@/tools/rippling/types'
import { CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import { customObjectRecordFields } from '@/tools/rippling/utils'
import { RIPPLING_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const ripplingCreateCustomObjectRecordTool: ToolConfig<RipplingCreateCustomObjectRecordParams> =
  {
    id: 'rippling_create_custom_object_record',
    name: 'Rippling Create Custom Object Record',
    description: 'Create a custom object record',
    version: '1.0.0',
    oauth: RIPPLING_CREDENTIAL_OAUTH,
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rippling API key',
      },
      customObjectApiName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Custom object API name',
      },
      externalId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'External ID for the record',
      },
      data: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Field values keyed by field API name (e.g. {"name": "License 4", "status__c": "ACTIVE"})',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${safeUrlPathSegment(params.customObjectApiName, 'customObjectApiName')}/records/`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        if (params.data == null || params.data === '') {
          throw new Error('data is required: the field values of the record to create')
        }
        const body: Record<string, unknown> = { ...customObjectRecordFields(params.data) }
        if (params.externalId != null && params.externalId !== '')
          body.external_id = params.externalId
        return body
      },
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }
      const json = await response.json()
      const record = (json.data ?? json) as Record<string, unknown>
      const {
        id,
        created_at,
        updated_at,
        name,
        external_id,
        created_by,
        last_modified_by,
        owner_role,
        system_updated_at,
        ...dynamicFields
      } = record
      return {
        success: true,
        output: {
          id: (id as string) ?? '',
          created_at: (created_at as string) ?? null,
          updated_at: (updated_at as string) ?? null,
          name: (name as string) ?? null,
          external_id: (external_id as string) ?? null,
          created_by: created_by ?? null,
          last_modified_by: last_modified_by ?? null,
          owner_role: owner_role ?? null,
          system_updated_at: (system_updated_at as string) ?? null,
          data: dynamicFields,
        },
      }
    },
    outputs: {
      ...CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES,
      data: { type: 'json', description: 'Full record data' },
    },
  }
