import type {
  AgiloftGetChoiceLineIdParams,
  AgiloftGetChoiceLineIdResponse,
} from '@/tools/agiloft/types'
import type { ToolConfig } from '@/tools/types'

export const agiloftGetChoiceLineIdTool: ToolConfig<
  AgiloftGetChoiceLineIdParams,
  AgiloftGetChoiceLineIdResponse
> = {
  id: 'agiloft_get_choice_line_id',
  name: 'Agiloft Get Choice Line ID',
  description:
    'Resolve the internal numeric ID of a choice-list value, for use in EWSelect WHERE clauses against choice fields.',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft instance URL (e.g., https://mycompany.agiloft.com)',
    },
    knowledgeBase: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Knowledge base name',
    },
    login: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft password',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name (e.g., "case", "contracts")',
    },
    fieldName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Choice field name (e.g., "priority", "status")',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Choice display value to resolve (e.g., "High", "Active")',
    },
  },

  request: {
    url: () => '/api/tools/agiloft/get_choice_line_id',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      instanceUrl: params.instanceUrl,
      knowledgeBase: params.knowledgeBase,
      login: params.login,
      password: params.password,
      table: params.table,
      fieldName: params.fieldName,
      value: params.value,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: data.success ?? true,
      output: data.output,
      ...(data.error ? { error: data.error } : {}),
    }
  },

  outputs: {
    choiceLineId: {
      type: 'number',
      description: 'Internal numeric line ID of the choice value',
      optional: true,
    },
  },
}
