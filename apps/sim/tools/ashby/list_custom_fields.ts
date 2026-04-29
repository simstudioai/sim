import { ashbyAuthHeaders, ashbyErrorMessage } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListCustomFieldsParams {
  apiKey: string
  cursor?: string
  perPage?: number
  syncToken?: string
  includeArchived?: boolean
}

interface AshbyCustomFieldDefinition {
  id: string
  title: string
  isPrivate: boolean
  fieldType: string
  objectType: string
  isArchived: boolean
  isRequired: boolean
  selectableValues: Array<{
    label: string
    value: string
    isArchived: boolean
  }>
}

interface AshbyListCustomFieldsResponse extends ToolResponse {
  output: {
    customFields: AshbyCustomFieldDefinition[]
    moreDataAvailable: boolean
    nextCursor: string | null
    syncToken: string | null
  }
}

export const listCustomFieldsTool: ToolConfig<
  AshbyListCustomFieldsParams,
  AshbyListCustomFieldsResponse
> = {
  id: 'ashby_list_custom_fields',
  name: 'Ashby List Custom Fields',
  description: 'Lists all custom field definitions configured in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default and max 100)',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token from a prior sync to fetch only items changed since then',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, includes archived custom fields in results (default false)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/customField.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      if (params.syncToken) body.syncToken = params.syncToken
      if (params.includeArchived !== undefined) body.includeArchived = params.includeArchived
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to list custom fields'))
    }

    return {
      success: true,
      output: {
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
        syncToken: data.syncToken ?? null,
        customFields: (data.results ?? []).map(
          (f: Record<string, unknown> & { selectableValues?: Array<Record<string, unknown>> }) => ({
            id: (f.id as string) ?? '',
            title: (f.title as string) ?? '',
            isPrivate: (f.isPrivate as boolean) ?? false,
            fieldType: (f.fieldType as string) ?? '',
            objectType: (f.objectType as string) ?? '',
            isArchived: (f.isArchived as boolean) ?? false,
            isRequired: (f.isRequired as boolean) ?? false,
            selectableValues: Array.isArray(f.selectableValues)
              ? f.selectableValues.map((v) => ({
                  label: (v.label as string) ?? '',
                  value: (v.value as string) ?? '',
                  isArchived: (v.isArchived as boolean) ?? false,
                }))
              : [],
          })
        ),
      },
    }
  },

  outputs: {
    customFields: {
      type: 'array',
      description: 'List of custom field definitions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Custom field UUID' },
          title: { type: 'string', description: 'Custom field title' },
          isPrivate: {
            type: 'boolean',
            description: 'Whether the custom field is private',
          },
          fieldType: {
            type: 'string',
            description:
              'Field data type (MultiValueSelect, NumberRange, String, Date, ValueSelect, Number, Currency, Boolean, LongText, CompensationRange)',
          },
          objectType: {
            type: 'string',
            description:
              'Object type the field applies to (Application, Candidate, Employee, Job, Offer, Opening, Talent_Project)',
          },
          isArchived: { type: 'boolean', description: 'Whether the custom field is archived' },
          isRequired: { type: 'boolean', description: 'Whether a value is required' },
          selectableValues: {
            type: 'array',
            description:
              'Selectable values for MultiValueSelect fields (empty for other field types)',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Display label' },
                value: { type: 'string', description: 'Stored value' },
                isArchived: { type: 'boolean', description: 'Whether archived' },
              },
            },
          },
        },
      },
    },
    moreDataAvailable: {
      type: 'boolean',
      description: 'Whether more pages of results exist',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for fetching the next page',
      optional: true,
    },
    syncToken: {
      type: 'string',
      description: 'Opaque sync token returned after the last page; pass on next sync',
      optional: true,
    },
  },
}
