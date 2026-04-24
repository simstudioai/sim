import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListCustomFieldsParams {
  apiKey: string
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
  },

  request: {
    url: 'https://api.ashbyhq.com/customField.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list custom fields')
    }

    return {
      success: true,
      output: {
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
  },
}
