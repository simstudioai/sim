import type {
  AgiloftGetChoiceLineIdParams,
  AgiloftGetChoiceLineIdResponse,
} from '@/tools/agiloft/types'
import { buildGetChoiceLineIdUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
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
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftGetChoiceLineIdResponse>(
      params,
      (base) => ({
        url: buildGetChoiceLineIdUrl(base, params),
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { choiceLineId: null },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const result = data.result ?? data
        let choiceLineId: number | null = null

        if (typeof result === 'number') {
          choiceLineId = result
        } else if (typeof result === 'string') {
          const parsed = Number(result)
          choiceLineId = Number.isFinite(parsed) ? parsed : null
        } else if (typeof result === 'object' && result !== null) {
          const obj = result as Record<string, unknown>
          const idVal = obj.id ?? obj.choiceLineId ?? obj.lineId
          if (typeof idVal === 'number') {
            choiceLineId = idVal
          } else if (typeof idVal === 'string') {
            const parsed = Number(idVal)
            choiceLineId = Number.isFinite(parsed) ? parsed : null
          }
        }

        if (choiceLineId === null) {
          return {
            success: false,
            output: { choiceLineId: null },
            error: `No choice line ID found for value "${params.value}" in field "${params.fieldName}"`,
          }
        }

        return {
          success: data.success !== false,
          output: { choiceLineId },
        }
      }
    )
  },

  outputs: {
    choiceLineId: {
      type: 'number',
      description: 'Internal numeric line ID of the choice value',
      optional: true,
    },
  },
}
