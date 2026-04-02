import type { RipplingUpdateCustomObjectFieldParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingUpdateCustomObjectFieldTool: ToolConfig<RipplingUpdateCustomObjectFieldParams> =
  {
    id: 'rippling_update_custom_object_field',
    name: 'Rippling Update Custom Object Field',
    description: 'Update a field on a custom object',
    version: '1.0.0',
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
      fieldApiName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Field API name',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Field name',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Description',
      },
      dataType: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Data type',
      },
      required: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the field is required',
      },
      rqlDefinition: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'RQL definition object',
      },
      isUnique: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Is unique',
      },
      formulaAttrMetas: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Formula attribute metadata',
      },
      section: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Section configuration',
      },
      enableHistory: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Enable history',
      },
      derivedFieldFormula: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Derived field formula expression',
      },
      nameFieldDetails: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Name field details configuration',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/fields/${encodeURIComponent(params.fieldApiName.trim())}/`,
      method: 'PATCH',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = {}
        if (params.name != null) body.name = params.name
        if (params.description != null) body.description = params.description
        if (params.dataType != null) body.data_type = params.dataType
        if (params.required != null) body.required = params.required
        if (params.rqlDefinition != null) body.rql_definition = params.rqlDefinition
        if (params.isUnique != null) body.is_unique = params.isUnique
        if (params.formulaAttrMetas != null) body.formula_attr_metas = params.formulaAttrMetas
        if (params.section != null) body.section = params.section
        if (params.enableHistory != null) body.enable_history = params.enableHistory
        if (params.derivedFieldFormula != null)
          body.derived_field_formula = params.derivedFieldFormula
        if (params.nameFieldDetails != null) body.name_field_details = params.nameFieldDetails
        return body
      },
    },
    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Rippling API error (${response.status}): ${errorText}`)
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          id: (data.id as string) ?? '',
          created_at: (data.created_at as string) ?? null,
          updated_at: (data.updated_at as string) ?? null,
          name: (data.name as string) ?? null,
          custom_object: (data.custom_object as string) ?? null,
          description: (data.description as string) ?? null,
          api_name: (data.api_name as string) ?? null,
          data_type: data.data_type ?? null,
          is_unique: (data.is_unique as boolean) ?? null,
          is_immutable: (data.is_immutable as boolean) ?? null,
          is_standard: (data.is_standard as boolean) ?? null,
          enable_history: (data.enable_history as boolean) ?? null,
          managed_package_install_id: (data.managed_package_install_id as string) ?? null,
        },
      }
    },
    outputs: {
      id: { type: 'string', description: 'Field ID' },
      created_at: { type: 'string', description: 'Creation date', optional: true },
      updated_at: { type: 'string', description: 'Update date', optional: true },
      name: { type: 'string', description: 'Name', optional: true },
      custom_object: { type: 'string', description: 'Custom object', optional: true },
      description: { type: 'string', description: 'Description', optional: true },
      api_name: { type: 'string', description: 'API name', optional: true },
      data_type: { type: 'json', description: 'Data type configuration', optional: true },
      is_unique: { type: 'boolean', description: 'Is unique', optional: true },
      is_immutable: { type: 'boolean', description: 'Is immutable', optional: true },
      is_standard: { type: 'boolean', description: 'Is standard', optional: true },
      enable_history: { type: 'boolean', description: 'History enabled', optional: true },
      managed_package_install_id: {
        type: 'string',
        description: 'Package install ID',
        optional: true,
      },
    },
  }
