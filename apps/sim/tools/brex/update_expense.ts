import type { BrexUpdateExpenseParams, BrexUpdateExpenseResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexUpdateExpenseTool: ToolConfig<BrexUpdateExpenseParams, BrexUpdateExpenseResponse> =
  {
    id: 'brex_update_expense',
    name: 'Brex Update Expense',
    description: 'Update the memo of a Brex card expense',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
      },
      expenseId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the card expense to update',
      },
      memo: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'New memo for the expense',
      },
    },

    request: {
      url: (params) =>
        `${BREX_API_BASE}/v1/expenses/card/${encodeURIComponent(params.expenseId.trim())}`,
      method: 'PUT',
      headers: (params) => buildBrexHeaders(params.apiKey),
      body: (params) => ({ memo: params.memo }),
    },

    transformResponse: async (response) => {
      const data = await parseBrexJson(response)
      return {
        success: true,
        output: {
          id: data.id ?? '',
          memo: data.memo ?? null,
          status: data.status ?? null,
          paymentStatus: data.payment_status ?? null,
          category: data.category ?? null,
          merchantId: data.merchant_id ?? null,
          budgetId: data.budget_id ?? null,
          originalAmount: data.original_amount ?? null,
          billingAmount: data.billing_amount ?? null,
          purchasedAt: data.purchased_at ?? null,
          updatedAt: data.updated_at ?? '',
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Unique expense ID' },
      memo: { type: 'string', description: 'Updated memo on the expense', optional: true },
      status: {
        type: 'string',
        description:
          'Expense status (DRAFT, SUBMITTED, APPROVED, OUT_OF_POLICY, VOID, CANCELED, SPLIT, SETTLED)',
        optional: true,
      },
      paymentStatus: {
        type: 'string',
        description:
          'Payment status (NOT_STARTED, PROCESSING, CANCELED, DECLINED, CLEARED, REFUNDING, REFUNDED, CASH_ADVANCE, CREDITED, AWAITING_PAYMENT, SCHEDULED)',
        optional: true,
      },
      category: {
        type: 'string',
        description:
          'Expense category (e.g., RESTAURANTS, RECURRING_SOFTWARE_AND_SAAS, AIRLINE_EXPENSES)',
        optional: true,
      },
      merchantId: { type: 'string', description: 'Merchant ID', optional: true },
      budgetId: { type: 'string', description: 'Budget ID', optional: true },
      originalAmount: {
        type: 'json',
        description: 'Original transaction amount',
        optional: true,
        properties: BREX_MONEY_PROPERTIES,
      },
      billingAmount: {
        type: 'json',
        description: 'Amount billed to the account',
        optional: true,
        properties: BREX_MONEY_PROPERTIES,
      },
      purchasedAt: { type: 'string', description: 'Purchase timestamp (ISO 8601)', optional: true },
      updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
    },
  }
