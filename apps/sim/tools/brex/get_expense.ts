import type { BrexGetExpenseParams, BrexGetExpenseResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

const EXPAND_FIELDS = [
  'merchant',
  'user',
  'budget',
  'department',
  'location',
  'receipts.download_uris',
]

export const brexGetExpenseTool: ToolConfig<BrexGetExpenseParams, BrexGetExpenseResponse> = {
  id: 'brex_get_expense',
  name: 'Brex Get Expense',
  description: 'Get a single Brex expense by its ID, including merchant, user, and receipt details',
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
      description: 'ID of the expense to fetch',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      for (const field of EXPAND_FIELDS) {
        query.append('expand[]', field)
      }
      return `${BREX_API_BASE}/v1/expenses/${encodeURIComponent(params.expenseId.trim())}?${query.toString()}`
    },
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
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
        expenseType: data.expense_type ?? null,
        category: data.category ?? null,
        merchantId: data.merchant_id ?? null,
        merchant: data.merchant ?? null,
        budgetId: data.budget_id ?? null,
        budget: data.budget ?? null,
        departmentId: data.department_id ?? null,
        department: data.department ?? null,
        locationId: data.location_id ?? null,
        location: data.location ?? null,
        userId: data.user_id ?? null,
        user: data.user ?? null,
        originalAmount: data.original_amount ?? null,
        billingAmount: data.billing_amount ?? null,
        purchasedAmount: data.purchased_amount ?? null,
        usdEquivalentAmount: data.usd_equivalent_amount ?? null,
        purchasedAt: data.purchased_at ?? null,
        updatedAt: data.updated_at ?? '',
        paymentPostedAt: data.payment_posted_at ?? null,
        receipts: data.receipts ?? [],
        dashboardUrl: data.dashboard_url ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique expense ID' },
    memo: { type: 'string', description: 'Memo on the expense', optional: true },
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
    expenseType: {
      type: 'string',
      description: 'Expense type (CARD, BILLPAY, REIMBURSEMENT, CLAWBACK, UNSET)',
      optional: true,
    },
    category: {
      type: 'string',
      description:
        'Expense category (e.g., RESTAURANTS, RECURRING_SOFTWARE_AND_SAAS, AIRLINE_EXPENSES)',
      optional: true,
    },
    merchantId: { type: 'string', description: 'Merchant ID', optional: true },
    merchant: {
      type: 'json',
      description: 'Merchant details (raw descriptor, MCC, country)',
      optional: true,
      properties: {
        raw_descriptor: { type: 'string', description: 'Raw merchant descriptor' },
        mcc: { type: 'string', description: 'Merchant category code' },
        country: { type: 'string', description: 'Merchant country' },
      },
    },
    budgetId: { type: 'string', description: 'Budget ID', optional: true },
    budget: {
      type: 'json',
      description: 'Budget the expense belongs to',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Budget ID' },
        name: { type: 'string', description: 'Budget name' },
      },
    },
    departmentId: { type: 'string', description: 'Department ID', optional: true },
    department: {
      type: 'json',
      description: 'Department of the expense owner',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Department ID' },
        name: { type: 'string', description: 'Department name' },
      },
    },
    locationId: { type: 'string', description: 'Location ID', optional: true },
    location: {
      type: 'json',
      description: 'Location of the expense owner',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Location ID' },
        name: { type: 'string', description: 'Location name' },
      },
    },
    userId: { type: 'string', description: 'ID of the user who made the expense', optional: true },
    user: {
      type: 'json',
      description: 'User who made the expense',
      optional: true,
      properties: {
        id: { type: 'string', description: 'User ID' },
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
      },
    },
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
    purchasedAmount: {
      type: 'json',
      description: 'Amount at the time of purchase',
      optional: true,
      properties: BREX_MONEY_PROPERTIES,
    },
    usdEquivalentAmount: {
      type: 'json',
      description: 'USD equivalent amount',
      optional: true,
      properties: BREX_MONEY_PROPERTIES,
    },
    purchasedAt: { type: 'string', description: 'Purchase timestamp (ISO 8601)', optional: true },
    updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
    paymentPostedAt: {
      type: 'string',
      description: 'Timestamp the payment was posted (ISO 8601)',
      optional: true,
    },
    receipts: {
      type: 'array',
      description: 'Receipts attached to the expense',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Receipt ID' },
          download_uris: { type: 'array', description: 'Pre-signed receipt download URLs' },
        },
      },
    },
    dashboardUrl: { type: 'string', description: 'Link to the expense in the Brex dashboard' },
  },
}
