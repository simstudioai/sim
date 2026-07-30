import type { BrexArchiveBudgetParams, BrexArchiveBudgetResponse } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexArchiveBudgetTool: ToolConfig<BrexArchiveBudgetParams, BrexArchiveBudgetResponse> =
  {
    id: 'brex_archive_budget',
    name: 'Brex Archive Budget',
    description:
      'Archive a Brex budget, making any spend limits beneath it unusable for future expenses and removing it from the UI',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
      },
      budgetId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the budget to archive',
      },
    },

    request: {
      url: (params) =>
        `${BREX_API_BASE}/v2/budgets/${encodeURIComponent(params.budgetId.trim())}/archive`,
      method: 'POST',
      headers: (params) => buildBrexHeaders(params.apiKey),
    },

    transformResponse: async (response, params) => {
      if (!response.ok) {
        // parseBrexJson throws a descriptive error for non-2xx responses; it never
        // returns in this branch since the body cannot be a successful JSON payload.
        await parseBrexJson(response)
      }

      // Brex's archive endpoint does not document a response body schema; fall back
      // to the request's budget ID and an ARCHIVED status when the body is empty.
      let data: Record<string, unknown> = {}
      const text = await response.text()
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = {}
        }
      }

      return {
        success: true,
        output: {
          budgetId: (data.budget_id as string) ?? params?.budgetId ?? '',
          spendBudgetStatus: (data.spend_budget_status as string) ?? 'ARCHIVED',
        },
      }
    },

    outputs: {
      budgetId: { type: 'string', description: 'ID of the archived budget' },
      spendBudgetStatus: {
        type: 'string',
        description: 'Status of the budget after archiving',
        optional: true,
      },
    },
  }
