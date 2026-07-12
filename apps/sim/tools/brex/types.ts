import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface BrexPaginationParams {
  apiKey: string
  cursor?: string
  limit?: string
}

export interface BrexMoney {
  amount: number
  currency: string | null
}

export interface BrexExpenseReceipt {
  id: string
  download_uris?: string[]
}

export interface BrexExpense {
  id: string
  memo: string | null
  status: string | null
  payment_status: string | null
  expense_type: string | null
  category: string | null
  merchant_id: string | null
  merchant: { raw_descriptor: string; mcc: string; country: string } | null
  budget_id: string | null
  budget: { id: string; name: string } | null
  department_id: string | null
  department: { id: string; name: string } | null
  location_id: string | null
  location: { id: string; name: string } | null
  user_id: string | null
  user: { id: string; first_name: string; last_name: string } | null
  original_amount: BrexMoney | null
  billing_amount: BrexMoney | null
  purchased_amount: BrexMoney | null
  usd_equivalent_amount: BrexMoney | null
  purchased_at: string | null
  updated_at: string
  payment_posted_at: string | null
  receipts: BrexExpenseReceipt[]
  dashboard_url: string
}

export interface BrexCardTransaction {
  id: string
  card_id: string | null
  description: string
  amount: BrexMoney
  initiated_at_date: string
  posted_at_date: string
  type: string | null
  merchant: { raw_descriptor: string; mcc: string; country: string } | null
  expense_id: string | null
}

export interface BrexCashTransaction {
  id: string
  description: string
  amount: BrexMoney | null
  initiated_at_date: string
  posted_at_date: string
  type: string | null
  transfer_id: string | null
}

export interface BrexCardAccount {
  id: string
  status: string | null
  current_balance: BrexMoney | null
  available_balance: BrexMoney | null
  account_limit: BrexMoney | null
  current_statement_period: { start_date: string; end_date: string }
}

export interface BrexCashAccount {
  id: string
  name: string
  status: string | null
  current_balance: BrexMoney
  available_balance: BrexMoney
  account_number: string
  routing_number: string
  primary: boolean
}

export interface BrexSpendLimitPeriodBalance {
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  amount_spent: BrexMoney | null
  rollover_amount: BrexMoney | null
}

export interface BrexUser {
  id: string
  first_name: string
  last_name: string
  email: string
  status: string | null
  manager_id: string | null
  department_id: string | null
  location_id: string | null
  title_id: string | null
}

export interface BrexDepartment {
  id: string
  name: string
  description: string | null
}

export interface BrexLocation {
  id: string
  name: string
  description: string | null
}

export interface BrexBudget {
  budget_id: string
  account_id: string
  name: string
  description: string | null
  parent_budget_id: string | null
  owner_user_ids: string[]
  period_recurrence_type: string
  start_date: string | null
  end_date: string | null
  amount: BrexMoney | null
  spend_budget_status: string
  limit_type: string | null
}

export interface BrexSpendLimit {
  id: string
  account_id: string
  name: string
  description: string | null
  parent_budget_id: string | null
  status: string
  period_recurrence_type: string
  spend_type: string
  start_date: string | null
  end_date: string | null
  owner_user_ids: string[]
  member_user_ids: string[]
  current_period_balance: BrexSpendLimitPeriodBalance | null
  authorization_settings: Record<string, unknown> | null
}

export interface BrexVendor {
  id: string
  company_name: string | null
  email: string | null
  phone: string | null
  payment_accounts: unknown[]
}

export interface BrexTransfer {
  id: string
  counterparty: Record<string, unknown> | null
  description: string | null
  payment_type: string
  amount: BrexMoney
  process_date: string | null
  originating_account: Record<string, unknown>
  status: string
  cancellation_reason: string | null
  estimated_delivery_date: string | null
  creator_user_id: string | null
  created_at: string | null
  display_name: string | null
  external_memo: string | null
  is_ppro_enabled: boolean | null
}

export interface BrexCard {
  id: string
  owner: Record<string, unknown>
  status: string | null
  last_four: string
  card_name: string
  card_type: string | null
  limit_type: string
  spend_controls: Record<string, unknown> | null
  billing_address: Record<string, unknown>
  expiration_date: Record<string, unknown>
  budget_id: string | null
}

export interface BrexStatement {
  id: string
  start_balance: BrexMoney | null
  end_balance: BrexMoney | null
  period: { start_date: string; end_date: string }
}

export interface BrexTitle {
  id: string
  name: string
}

export interface BrexListExpensesParams extends BrexPaginationParams {
  userIds?: string
  statuses?: string
  paymentStatuses?: string
  purchasedAtStart?: string
  purchasedAtEnd?: string
}

export interface BrexGetExpenseParams {
  apiKey: string
  expenseId: string
}

export interface BrexUpdateExpenseParams {
  apiKey: string
  expenseId: string
  memo: string
}

export interface BrexUploadReceiptParams {
  apiKey: string
  expenseId: string
  file?: unknown
  receiptName?: string
}

export interface BrexMatchReceiptParams {
  apiKey: string
  file?: unknown
  receiptName?: string
}

export interface BrexListCardTransactionsParams extends BrexPaginationParams {
  userIds?: string
  postedAtStart?: string
}

export interface BrexListCashTransactionsParams extends BrexPaginationParams {
  accountId: string
  postedAtStart?: string
}

export interface BrexListUsersParams extends BrexPaginationParams {
  email?: string
}

export interface BrexGetUserParams {
  apiKey: string
  userId: string
}

export interface BrexNameFilterParams extends BrexPaginationParams {
  name?: string
}

export interface BrexListSpendLimitsParams extends BrexPaginationParams {
  memberUserIds?: string
}

export interface BrexApiKeyParams {
  apiKey: string
}

export interface BrexGetCashAccountParams {
  apiKey: string
  accountId?: string
}

export interface BrexListCardsParams extends BrexPaginationParams {
  userId?: string
}

export interface BrexListCashStatementsParams extends BrexPaginationParams {
  accountId: string
}

export interface BrexGetBudgetParams {
  apiKey: string
  budgetId: string
}

export interface BrexGetSpendLimitParams {
  apiKey: string
  spendLimitId: string
}

export interface BrexGetVendorParams {
  apiKey: string
  vendorId: string
}

export interface BrexGetTransferParams {
  apiKey: string
  transferId: string
}

export interface BrexCreateTransferParams {
  apiKey: string
  cashAccountId: string
  vendorPaymentInstrumentId: string
  amount: number
  currency?: string
  description: string
  externalMemo: string
  approvalType?: string
  isPproEnabled?: boolean
}

export interface BrexCreateBudgetParams {
  apiKey: string
  name: string
  description: string
  parentBudgetId: string
  periodRecurrenceType: string
  amount: number
  currency?: string
  ownerUserIds?: string
  startDate?: string
  endDate?: string
}

export interface BrexArchiveBudgetParams {
  apiKey: string
  budgetId: string
}

export interface BrexCreateSpendLimitParams {
  apiKey: string
  name: string
  periodRecurrenceType: string
  spendType: string
  expenseVisibility: string
  authorizationVisibility: string
  limitIncreaseSetting: string
  autoTransferCardsSetting: string
  autoCreateLimitCardsSetting: string
  expensePolicyId: string
  baseLimitAmount: number
  currency?: string
  authorizationType: string
  rolloverRefreshRate: string
  limitBufferPercentage?: number
  description?: string
  parentBudgetId?: string
  startDate?: string
  endDate?: string
  transactionLimitAmount?: number
  ownerUserIds?: string
  memberUserIds?: string
}

export interface BrexCreateVendorParams {
  apiKey: string
  companyName: string
  email?: string
  phone?: string
}

export interface BrexUpdateVendorParams {
  apiKey: string
  vendorId: string
  companyName?: string
  email?: string
  phone?: string
}

export interface BrexListExpensesResponse extends ToolResponse {
  output: {
    items: BrexExpense[]
    nextCursor: string | null
  }
}

export interface BrexGetExpenseResponse extends ToolResponse {
  output: {
    id: string
    memo: string | null
    status: string | null
    paymentStatus: string | null
    expenseType: string | null
    category: string | null
    merchantId: string | null
    merchant: BrexExpense['merchant']
    budgetId: string | null
    budget: BrexExpense['budget']
    departmentId: string | null
    department: BrexExpense['department']
    locationId: string | null
    location: BrexExpense['location']
    userId: string | null
    user: BrexExpense['user']
    originalAmount: BrexMoney | null
    billingAmount: BrexMoney | null
    purchasedAmount: BrexMoney | null
    usdEquivalentAmount: BrexMoney | null
    purchasedAt: string | null
    updatedAt: string
    paymentPostedAt: string | null
    receipts: BrexExpenseReceipt[]
    dashboardUrl: string
  }
}

export interface BrexUpdateExpenseResponse extends ToolResponse {
  output: {
    id: string
    memo: string | null
    status: string | null
    paymentStatus: string | null
    category: string | null
    merchantId: string | null
    budgetId: string | null
    originalAmount: BrexMoney | null
    billingAmount: BrexMoney | null
    purchasedAt: string | null
    updatedAt: string
  }
}

export interface BrexUploadReceiptResponse extends ToolResponse {
  output: {
    receiptId: string
    receiptName: string
    expenseId: string | null
  }
}

export interface BrexListCardTransactionsResponse extends ToolResponse {
  output: {
    items: BrexCardTransaction[]
    nextCursor: string | null
  }
}

export interface BrexListCashTransactionsResponse extends ToolResponse {
  output: {
    items: BrexCashTransaction[]
    nextCursor: string | null
  }
}

export interface BrexListCardAccountsResponse extends ToolResponse {
  output: {
    accounts: BrexCardAccount[]
  }
}

export interface BrexListCashAccountsResponse extends ToolResponse {
  output: {
    items: BrexCashAccount[]
    nextCursor: string | null
  }
}

export interface BrexListUsersResponse extends ToolResponse {
  output: {
    items: BrexUser[]
    nextCursor: string | null
  }
}

export interface BrexGetUserResponse extends ToolResponse {
  output: {
    id: string
    firstName: string
    lastName: string
    email: string
    status: string | null
    managerId: string | null
    departmentId: string | null
    locationId: string | null
    titleId: string | null
  }
}

export interface BrexListDepartmentsResponse extends ToolResponse {
  output: {
    items: BrexDepartment[]
    nextCursor: string | null
  }
}

export interface BrexListLocationsResponse extends ToolResponse {
  output: {
    items: BrexLocation[]
    nextCursor: string | null
  }
}

export interface BrexListBudgetsResponse extends ToolResponse {
  output: {
    items: BrexBudget[]
    nextCursor: string | null
  }
}

export interface BrexListSpendLimitsResponse extends ToolResponse {
  output: {
    items: BrexSpendLimit[]
    nextCursor: string | null
  }
}

export interface BrexListVendorsResponse extends ToolResponse {
  output: {
    items: BrexVendor[]
    nextCursor: string | null
  }
}

export interface BrexListTransfersResponse extends ToolResponse {
  output: {
    items: BrexTransfer[]
    nextCursor: string | null
  }
}

export interface BrexGetCompanyResponse extends ToolResponse {
  output: {
    id: string
    legalName: string
    mailingAddress: Record<string, unknown> | null
    accountType: string | null
  }
}

export interface BrexListCardsResponse extends ToolResponse {
  output: {
    items: BrexCard[]
    nextCursor: string | null
  }
}

export interface BrexListTitlesResponse extends ToolResponse {
  output: {
    items: BrexTitle[]
    nextCursor: string | null
  }
}

export interface BrexGetCashAccountResponse extends ToolResponse {
  output: {
    id: string
    name: string
    status: string | null
    currentBalance: BrexMoney
    availableBalance: BrexMoney
    accountNumber: string
    routingNumber: string
    primary: boolean
  }
}

export interface BrexListStatementsResponse extends ToolResponse {
  output: {
    items: BrexStatement[]
    nextCursor: string | null
  }
}

export interface BrexGetBudgetResponse extends ToolResponse {
  output: {
    budgetId: string
    accountId: string
    name: string
    description: string | null
    parentBudgetId: string | null
    ownerUserIds: string[]
    periodRecurrenceType: string
    startDate: string | null
    endDate: string | null
    amount: BrexMoney | null
    spendBudgetStatus: string
    limitType: string | null
  }
}

export interface BrexGetSpendLimitResponse extends ToolResponse {
  output: {
    id: string
    accountId: string
    name: string
    description: string | null
    parentBudgetId: string | null
    status: string
    periodRecurrenceType: string
    spendType: string
    startDate: string | null
    endDate: string | null
    ownerUserIds: string[]
    memberUserIds: string[]
    currentPeriodBalance: BrexSpendLimitPeriodBalance | null
    authorizationSettings: Record<string, unknown> | null
  }
}

export interface BrexGetVendorResponse extends ToolResponse {
  output: {
    id: string
    companyName: string | null
    email: string | null
    phone: string | null
    paymentAccounts: unknown[]
  }
}

export interface BrexGetTransferResponse extends ToolResponse {
  output: {
    id: string
    counterparty: Record<string, unknown> | null
    description: string | null
    paymentType: string
    amount: BrexMoney | null
    processDate: string | null
    originatingAccount: Record<string, unknown> | null
    status: string
    cancellationReason: string | null
    estimatedDeliveryDate: string | null
    creatorUserId: string | null
    createdAt: string | null
    displayName: string | null
    externalMemo: string | null
    isPproEnabled: boolean | null
  }
}

export interface BrexCreateTransferResponse extends ToolResponse {
  output: {
    id: string
    counterparty: Record<string, unknown> | null
    description: string | null
    paymentType: string
    amount: BrexMoney | null
    processDate: string | null
    originatingAccount: Record<string, unknown> | null
    status: string
    cancellationReason: string | null
    estimatedDeliveryDate: string | null
    creatorUserId: string | null
    createdAt: string | null
    displayName: string | null
    externalMemo: string | null
    isPproEnabled: boolean | null
  }
}

export interface BrexCreateBudgetResponse extends ToolResponse {
  output: {
    budgetId: string
    accountId: string
    name: string
    description: string | null
    parentBudgetId: string | null
    ownerUserIds: string[]
    periodRecurrenceType: string
    startDate: string | null
    endDate: string | null
    amount: BrexMoney | null
    spendBudgetStatus: string
    limitType: string | null
  }
}

export interface BrexArchiveBudgetResponse extends ToolResponse {
  output: {
    budgetId: string
    spendBudgetStatus: string | null
  }
}

export interface BrexCreateSpendLimitResponse extends ToolResponse {
  output: {
    id: string
    accountId: string
    name: string
    description: string | null
    parentBudgetId: string | null
    status: string
    periodRecurrenceType: string
    spendType: string
    startDate: string | null
    endDate: string | null
    ownerUserIds: string[]
    memberUserIds: string[]
    currentPeriodBalance: BrexSpendLimitPeriodBalance | null
    authorizationSettings: Record<string, unknown> | null
  }
}

export interface BrexCreateVendorResponse extends ToolResponse {
  output: {
    id: string
    companyName: string | null
    email: string | null
    phone: string | null
    paymentAccounts: unknown[]
  }
}

export interface BrexUpdateVendorResponse extends ToolResponse {
  output: {
    id: string
    companyName: string | null
    email: string | null
    phone: string | null
    paymentAccounts: unknown[]
  }
}

export type BrexResponse =
  | BrexListExpensesResponse
  | BrexGetExpenseResponse
  | BrexUpdateExpenseResponse
  | BrexUploadReceiptResponse
  | BrexListCardTransactionsResponse
  | BrexListCashTransactionsResponse
  | BrexListCardAccountsResponse
  | BrexListCashAccountsResponse
  | BrexListUsersResponse
  | BrexGetUserResponse
  | BrexListDepartmentsResponse
  | BrexListLocationsResponse
  | BrexListBudgetsResponse
  | BrexListSpendLimitsResponse
  | BrexListVendorsResponse
  | BrexListTransfersResponse
  | BrexGetCompanyResponse
  | BrexListCardsResponse
  | BrexListTitlesResponse
  | BrexGetCashAccountResponse
  | BrexListStatementsResponse
  | BrexGetBudgetResponse
  | BrexGetSpendLimitResponse
  | BrexGetVendorResponse
  | BrexGetTransferResponse
  | BrexCreateTransferResponse
  | BrexCreateBudgetResponse
  | BrexArchiveBudgetResponse
  | BrexCreateSpendLimitResponse
  | BrexCreateVendorResponse
  | BrexUpdateVendorResponse

export const BREX_MONEY_PROPERTIES: Record<string, OutputProperty> = {
  amount: {
    type: 'number',
    description: 'Amount in the smallest unit of the currency (e.g., cents for USD)',
  },
  currency: {
    type: 'string',
    description: 'ISO 4217 currency code (e.g., USD)',
    optional: true,
  },
}

export const BREX_SPEND_LIMIT_PERIOD_BALANCE_PROPERTIES: Record<string, OutputProperty> = {
  start_date: { type: 'string', description: 'Start date of the current period', optional: true },
  end_date: { type: 'string', description: 'End date of the current period', optional: true },
  start_time: {
    type: 'string',
    description: 'Start time of the current period (ISO 8601)',
    optional: true,
  },
  end_time: {
    type: 'string',
    description: 'End time of the current period (ISO 8601)',
    optional: true,
  },
  amount_spent: {
    type: 'json',
    description: 'Amount spent in the current period',
    optional: true,
    properties: BREX_MONEY_PROPERTIES,
  },
  rollover_amount: {
    type: 'json',
    description: 'Amount rolled over from previous periods',
    optional: true,
    properties: BREX_MONEY_PROPERTIES,
  },
}

export const BREX_EXPENSE_ITEM_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique expense ID' },
  memo: { type: 'string', description: 'Memo on the expense', optional: true },
  status: {
    type: 'string',
    description:
      'Expense status (DRAFT, SUBMITTED, APPROVED, OUT_OF_POLICY, VOID, CANCELED, SPLIT, SETTLED)',
    optional: true,
  },
  payment_status: {
    type: 'string',
    description:
      'Payment status (NOT_STARTED, PROCESSING, CANCELED, DECLINED, CLEARED, REFUNDING, REFUNDED, CASH_ADVANCE, CREDITED, AWAITING_PAYMENT, SCHEDULED)',
    optional: true,
  },
  expense_type: {
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
  merchant: {
    type: 'json',
    description: 'Merchant details',
    optional: true,
    properties: {
      raw_descriptor: { type: 'string', description: 'Raw merchant descriptor' },
      mcc: { type: 'string', description: 'Merchant category code' },
      country: { type: 'string', description: 'Merchant country' },
    },
  },
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
  budget: {
    type: 'json',
    description: 'Budget the expense belongs to',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Budget ID' },
      name: { type: 'string', description: 'Budget name' },
    },
  },
  department: {
    type: 'json',
    description: 'Department of the expense owner',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Department ID' },
      name: { type: 'string', description: 'Department name' },
    },
  },
  location: {
    type: 'json',
    description: 'Location of the expense owner',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Location ID' },
      name: { type: 'string', description: 'Location name' },
    },
  },
  original_amount: {
    type: 'json',
    description: 'Original transaction amount',
    optional: true,
    properties: BREX_MONEY_PROPERTIES,
  },
  billing_amount: {
    type: 'json',
    description: 'Amount billed to the account',
    optional: true,
    properties: BREX_MONEY_PROPERTIES,
  },
  purchased_amount: {
    type: 'json',
    description: 'Amount at the time of purchase',
    optional: true,
    properties: BREX_MONEY_PROPERTIES,
  },
  receipts: {
    type: 'array',
    description: 'Receipts attached to the expense',
    optional: true,
    items: {
      type: 'json',
      properties: {
        id: { type: 'string', description: 'Receipt ID' },
        download_uris: { type: 'array', description: 'Pre-signed receipt download URLs' },
      },
    },
  },
  purchased_at: { type: 'string', description: 'Purchase timestamp (ISO 8601)', optional: true },
  updated_at: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  dashboard_url: { type: 'string', description: 'Link to the expense in the Brex dashboard' },
}

export const BREX_CARD_TRANSACTION_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique transaction ID' },
  card_id: { type: 'string', description: 'ID of the card used', optional: true },
  description: { type: 'string', description: 'Transaction description' },
  amount: {
    type: 'json',
    description: 'Transaction amount',
    properties: BREX_MONEY_PROPERTIES,
  },
  initiated_at_date: { type: 'string', description: 'Date the transaction was initiated' },
  posted_at_date: { type: 'string', description: 'Date the transaction was posted' },
  type: {
    type: 'string',
    description:
      'Transaction type (PURCHASE, REFUND, CHARGEBACK, REWARDS_CREDIT, COLLECTION, BNPL_FEE)',
    optional: true,
  },
  merchant: {
    type: 'json',
    description: 'Merchant details',
    optional: true,
    properties: {
      raw_descriptor: { type: 'string', description: 'Raw merchant descriptor' },
      mcc: { type: 'string', description: 'Merchant category code' },
      country: { type: 'string', description: 'Merchant country' },
    },
  },
  expense_id: { type: 'string', description: 'Associated expense ID', optional: true },
}

export const BREX_CASH_TRANSACTION_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique transaction ID' },
  description: { type: 'string', description: 'Transaction description' },
  amount: {
    type: 'json',
    description: 'Transaction amount',
    optional: true,
    properties: BREX_MONEY_PROPERTIES,
  },
  initiated_at_date: { type: 'string', description: 'Date the transaction was initiated' },
  posted_at_date: { type: 'string', description: 'Date the transaction was posted' },
  type: { type: 'string', description: 'Transaction type', optional: true },
  transfer_id: { type: 'string', description: 'Associated transfer ID', optional: true },
}

export const BREX_USER_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique user ID' },
  first_name: { type: 'string', description: 'First name' },
  last_name: { type: 'string', description: 'Last name' },
  email: { type: 'string', description: 'Email address' },
  status: {
    type: 'string',
    description:
      'User status (INVITED, ACTIVE, CLOSED, DISABLED, DELETED, PENDING_ACTIVATION, INACTIVE, ARCHIVED)',
    optional: true,
  },
  manager_id: { type: 'string', description: 'ID of the manager', optional: true },
  department_id: { type: 'string', description: 'Department ID', optional: true },
  location_id: { type: 'string', description: 'Location ID', optional: true },
  title_id: { type: 'string', description: 'Title ID', optional: true },
}
