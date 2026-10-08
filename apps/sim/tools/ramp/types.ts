import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface RampAmount {
  currency: string | null
  value: number | null
}

const RAMP_AMOUNT_PROPERTIES = {
  currency: { type: 'string', description: 'Currency', nullable: true },
  value: {
    type: 'number',
    description: 'Amount in the smallest currency denomination; signed for transactions',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface RampCurrencyAmount {
  amount: number | null
  currency_code: string | null
  minor_unit_conversion_rate: number | null
}

const RAMP_CURRENCY_AMOUNT_PROPERTIES = {
  amount: {
    type: 'number',
    description: 'Amount in the smallest currency denomination',
    nullable: true,
  },
  currency_code: { type: 'string', description: 'Currency code', nullable: true },
  minor_unit_conversion_rate: {
    type: 'number',
    description: 'Divide the amount by this factor to get the major currency value',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface RampReimbursementAmount {
  currency: string | null
  value: number | null
  minor_unit_conversion_rate: number | null
}

const RAMP_REIMBURSEMENT_AMOUNT_PROPERTIES = {
  currency: { type: 'string', description: 'Currency', nullable: true },
  value: {
    type: 'number',
    description: 'Non-negative amount in the smallest currency denomination',
    nullable: true,
  },
  minor_unit_conversion_rate: {
    type: 'number',
    description: 'Divide the amount by this factor to get the major currency value',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface RampBillVendor {
  id: string | null
  name: string | null
  remote_id: string | null
  remote_name: string | null
  type: string | null
}

const RAMP_BILL_VENDOR_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
  remote_id: { type: 'string', description: 'Remote id', nullable: true },
  remote_name: { type: 'string', description: 'Remote name', nullable: true },
  type: { type: 'string', description: 'Type', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampCardHolder {
  user_id: string | null
  first_name: string | null
  last_name: string | null
  department_id: string | null
  department_name: string | null
}

const RAMP_CARD_HOLDER_PROPERTIES = {
  user_id: { type: 'string', description: 'User id', nullable: true },
  first_name: { type: 'string', description: 'First name', nullable: true },
  last_name: { type: 'string', description: 'Last name', nullable: true },
  department_id: { type: 'string', description: 'Department id', nullable: true },
  department_name: { type: 'string', description: 'Department name', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampBusiness {
  id: string | null
  business_name_legal: string | null
  business_name_on_card: string | null
  active: boolean | null
  created_time: string | null
  website: string | null
  is_reimbursements_enabled: boolean | null
  initial_approved_limit_amount: RampAmount | null
}

export const RAMP_BUSINESS_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  business_name_legal: { type: 'string', description: 'Business name legal', nullable: true },
  business_name_on_card: { type: 'string', description: 'Business name on card', nullable: true },
  active: { type: 'boolean', description: 'Active', nullable: true },
  created_time: { type: 'string', description: 'Created time', nullable: true },
  website: { type: 'string', description: 'Website', nullable: true },
  is_reimbursements_enabled: {
    type: 'boolean',
    description: 'Is reimbursements enabled',
    nullable: true,
  },
  initial_approved_limit_amount: {
    type: 'json',
    description: 'Initial approved limit amount',
    properties: RAMP_AMOUNT_PROPERTIES,
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface RampBalance {
  card_limit_amount: RampCurrencyAmount | null
  available_card_limit_amount: RampCurrencyAmount | null
  card_balance_including_pending_amount: RampCurrencyAmount | null
  card_balance_excluding_pending_amount: RampCurrencyAmount | null
  statement_balance_amount: RampCurrencyAmount | null
  next_billing_date: string | null
  prev_billing_date: string | null
}

export const RAMP_BALANCE_PROPERTIES = {
  card_limit_amount: {
    type: 'json',
    description: 'Card limit amount',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
  available_card_limit_amount: {
    type: 'json',
    description: 'Available card limit amount',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
  card_balance_including_pending_amount: {
    type: 'json',
    description: 'Card balance including pending amount',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
  card_balance_excluding_pending_amount: {
    type: 'json',
    description: 'Card balance excluding pending amount',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
  statement_balance_amount: {
    type: 'json',
    description: 'Statement balance amount',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
  next_billing_date: { type: 'string', description: 'Next billing date', nullable: true },
  prev_billing_date: { type: 'string', description: 'Prev billing date', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampUser {
  id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  role: string | null
  status: string | null
  employee_id: string | null
  department_id: string | null
  location_id: string | null
  manager_id: string | null
  entity_id: string | null
  is_manager: boolean | null
}

export const RAMP_USER_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  first_name: { type: 'string', description: 'First name', nullable: true },
  last_name: { type: 'string', description: 'Last name', nullable: true },
  email: { type: 'string', description: 'Email', nullable: true },
  role: { type: 'string', description: 'Role', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  employee_id: { type: 'string', description: 'Employee id', nullable: true },
  department_id: { type: 'string', description: 'Department id', nullable: true },
  location_id: { type: 'string', description: 'Location id', nullable: true },
  manager_id: { type: 'string', description: 'Manager id', nullable: true },
  entity_id: { type: 'string', description: 'Entity id', nullable: true },
  is_manager: { type: 'boolean', description: 'Is manager', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampTransaction {
  id: string | null
  entity_amount: RampAmount | null
  merchant_amount: RampAmount | null
  merchant_name: string | null
  merchant_descriptor: string | null
  merchant_category_code: string | null
  memo: string | null
  state: string | null
  card_id: string | null
  card_holder: RampCardHolder | null
  user_transaction_time: string | null
  settlement_date: string | null
  all_requirements_met_and_approved: boolean | null
  sync_status: string | null
  entity_id: string | null
  updated_at: string | null
}

export const RAMP_TRANSACTION_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  entity_amount: {
    type: 'json',
    description: 'Entity amount',
    properties: RAMP_AMOUNT_PROPERTIES,
    nullable: true,
  },
  merchant_amount: {
    type: 'json',
    description: 'Merchant amount',
    properties: RAMP_AMOUNT_PROPERTIES,
    nullable: true,
  },
  merchant_name: { type: 'string', description: 'Merchant name', nullable: true },
  merchant_descriptor: { type: 'string', description: 'Merchant descriptor', nullable: true },
  merchant_category_code: { type: 'string', description: 'Merchant category code', nullable: true },
  memo: { type: 'string', description: 'Memo', nullable: true },
  state: { type: 'string', description: 'State', nullable: true },
  card_id: { type: 'string', description: 'Card id', nullable: true },
  card_holder: {
    type: 'json',
    description: 'Card holder',
    properties: RAMP_CARD_HOLDER_PROPERTIES,
    nullable: true,
  },
  user_transaction_time: { type: 'string', description: 'User transaction time', nullable: true },
  settlement_date: { type: 'string', description: 'Settlement date', nullable: true },
  all_requirements_met_and_approved: {
    type: 'boolean',
    description: 'All requirements met and approved',
    nullable: true,
  },
  sync_status: { type: 'string', description: 'Sync status', nullable: true },
  entity_id: { type: 'string', description: 'Entity id', nullable: true },
  updated_at: { type: 'string', description: 'Updated at', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampPhysicalCard {
  id: string | null
  cardholder_id: string | null
  cardholder_name: string | null
  display_name: string | null
  last_four: string | null
  state: string | null
  is_suspended: boolean | null
  fund_id: string | null
  created_at: string | null
}

export const RAMP_PHYSICAL_CARD_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  cardholder_id: { type: 'string', description: 'Cardholder id', nullable: true },
  cardholder_name: { type: 'string', description: 'Cardholder name', nullable: true },
  display_name: { type: 'string', description: 'Display name', nullable: true },
  last_four: { type: 'string', description: 'Last four', nullable: true },
  state: { type: 'string', description: 'State', nullable: true },
  is_suspended: { type: 'boolean', description: 'Is suspended', nullable: true },
  fund_id: { type: 'string', description: 'Fund id', nullable: true },
  created_at: { type: 'string', description: 'Created at', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampVirtualCard {
  id: string | null
  user_id: string | null
  fund_id: string | null
  is_card_suspended: boolean | null
  created_at: string | null
}

export const RAMP_VIRTUAL_CARD_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  user_id: { type: 'string', description: 'User id', nullable: true },
  fund_id: { type: 'string', description: 'Fund id', nullable: true },
  is_card_suspended: { type: 'boolean', description: 'Is card suspended', nullable: true },
  created_at: { type: 'string', description: 'Created at', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampVendor {
  id: string | null
  name: string | null
  name_legal: string | null
  description: string | null
  is_active: boolean | null
  external_vendor_id: string | null
  accounting_vendor_remote_id: string | null
  vendor_owner_id: string | null
  country: string | null
  created_at: string | null
  total_spend_all_time: RampCurrencyAmount | null
  total_spend_last_30_days: RampCurrencyAmount | null
  total_spend_ytd: RampCurrencyAmount | null
}

export const RAMP_VENDOR_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
  name_legal: { type: 'string', description: 'Name legal', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  is_active: { type: 'boolean', description: 'Is active', nullable: true },
  external_vendor_id: { type: 'string', description: 'External vendor id', nullable: true },
  accounting_vendor_remote_id: {
    type: 'string',
    description: 'Accounting vendor remote id',
    nullable: true,
  },
  vendor_owner_id: { type: 'string', description: 'Vendor owner id', nullable: true },
  country: { type: 'string', description: 'Country', nullable: true },
  created_at: { type: 'string', description: 'Created at', nullable: true },
  total_spend_all_time: {
    type: 'json',
    description: 'Total spend all time',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
  total_spend_last_30_days: {
    type: 'json',
    description: 'Total spend last 30 days',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
  total_spend_ytd: {
    type: 'json',
    description: 'Total spend ytd',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface RampBill {
  id: string | null
  invoice_number: string | null
  amount: RampCurrencyAmount | null
  vendor: RampBillVendor | null
  memo: string | null
  status: string | null
  status_summary: string | null
  approval_status: string | null
  sync_status: string | null
  due_at: string | null
  issued_at: string | null
  paid_at: string | null
  created_at: string | null
  entity_id: string | null
}

export const RAMP_BILL_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  invoice_number: { type: 'string', description: 'Invoice number', nullable: true },
  amount: {
    type: 'json',
    description: 'Amount in the smallest currency denomination',
    properties: RAMP_CURRENCY_AMOUNT_PROPERTIES,
    nullable: true,
  },
  vendor: {
    type: 'json',
    description: 'Vendor',
    properties: RAMP_BILL_VENDOR_PROPERTIES,
    nullable: true,
  },
  memo: { type: 'string', description: 'Memo', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  status_summary: { type: 'string', description: 'Status summary', nullable: true },
  approval_status: { type: 'string', description: 'Approval status', nullable: true },
  sync_status: { type: 'string', description: 'Sync status', nullable: true },
  due_at: { type: 'string', description: 'Due at', nullable: true },
  issued_at: { type: 'string', description: 'Issued at', nullable: true },
  paid_at: { type: 'string', description: 'Paid at', nullable: true },
  created_at: { type: 'string', description: 'Created at', nullable: true },
  entity_id: { type: 'string', description: 'Entity id', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampReimbursement {
  id: string | null
  user_id: string | null
  user_email: string | null
  user_full_name: string | null
  entity_amount: RampReimbursementAmount | null
  merchant_amount: RampReimbursementAmount | null
  merchant: string | null
  memo: string | null
  state: string | null
  direction: string | null
  type: string | null
  transaction_date: string | null
  created_at: string | null
  submitted_at: string | null
  approved_at: string | null
  payment_processed_at: string | null
  sync_status: string | null
  entity_id: string | null
}

export const RAMP_REIMBURSEMENT_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  user_id: { type: 'string', description: 'User id', nullable: true },
  user_email: { type: 'string', description: 'User email', nullable: true },
  user_full_name: { type: 'string', description: 'User full name', nullable: true },
  entity_amount: {
    type: 'json',
    description: 'Entity amount',
    properties: RAMP_REIMBURSEMENT_AMOUNT_PROPERTIES,
    nullable: true,
  },
  merchant_amount: {
    type: 'json',
    description: 'Merchant amount',
    properties: RAMP_REIMBURSEMENT_AMOUNT_PROPERTIES,
    nullable: true,
  },
  merchant: { type: 'string', description: 'Merchant', nullable: true },
  memo: { type: 'string', description: 'Memo', nullable: true },
  state: { type: 'string', description: 'State', nullable: true },
  direction: { type: 'string', description: 'Direction', nullable: true },
  type: { type: 'string', description: 'Type', nullable: true },
  transaction_date: { type: 'string', description: 'Transaction date', nullable: true },
  created_at: { type: 'string', description: 'Created at', nullable: true },
  submitted_at: { type: 'string', description: 'Submitted at', nullable: true },
  approved_at: { type: 'string', description: 'Approved at', nullable: true },
  payment_processed_at: { type: 'string', description: 'Payment processed at', nullable: true },
  sync_status: { type: 'string', description: 'Sync status', nullable: true },
  entity_id: { type: 'string', description: 'Entity id', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampMemo {
  id: string | null
  memo: string | null
}

export const RAMP_MEMO_PROPERTIES = {
  id: { type: 'string', description: 'Id', nullable: true },
  memo: { type: 'string', description: 'Memo', nullable: true },
} as const satisfies Record<string, OutputProperty>

export interface RampGetBusinessParams {
  accessToken: string
}

export interface RampGetBusinessResponse extends ToolResponse {
  output: {
    business: RampBusiness
  }
}

export interface RampGetBalanceParams {
  accessToken: string
}

export interface RampGetBalanceResponse extends ToolResponse {
  output: {
    balance: RampBalance
  }
}

export interface RampListUsersParams {
  accessToken: string
  email?: string
  status?: string
  department_id?: string
  entity_id?: string
  start?: string
  page_size?: number
}

export interface RampListUsersResponse extends ToolResponse {
  output: {
    users: RampUser[]
    nextCursor: string | null
    nextPageUrl: string | null
  }
}

export interface RampGetUserParams {
  accessToken: string
  user_id: string
}

export interface RampGetUserResponse extends ToolResponse {
  output: {
    user: RampUser
  }
}

export interface RampListTransactionsParams {
  accessToken: string
  user_id?: string
  department_id?: string
  from_date?: string
  to_date?: string
  transaction_state?: string
  sync_status?: string
  start?: string
  page_size?: number
}

export interface RampListTransactionsResponse extends ToolResponse {
  output: {
    transactions: RampTransaction[]
    nextCursor: string | null
    nextPageUrl: string | null
  }
}

export interface RampGetTransactionParams {
  accessToken: string
  transaction_id: string
}

export interface RampGetTransactionResponse extends ToolResponse {
  output: {
    transaction: RampTransaction
  }
}

export interface RampListPhysicalCardsParams {
  accessToken: string
  user_id?: string
  display_name?: string
  start?: string
  page_size?: number
}

export interface RampListPhysicalCardsResponse extends ToolResponse {
  output: {
    physicalCards: RampPhysicalCard[]
    nextCursor: string | null
    nextPageUrl: string | null
  }
}

export interface RampGetPhysicalCardParams {
  accessToken: string
  card_id: string
}

export interface RampGetPhysicalCardResponse extends ToolResponse {
  output: {
    physicalCard: RampPhysicalCard
  }
}

export interface RampListVirtualCardsParams {
  accessToken: string
  user_id?: string
  entity_id?: string
  start?: string
  page_size?: number
}

export interface RampListVirtualCardsResponse extends ToolResponse {
  output: {
    virtualCards: RampVirtualCard[]
    nextCursor: string | null
    nextPageUrl: string | null
  }
}

export interface RampGetVirtualCardParams {
  accessToken: string
  card_id: string
}

export interface RampGetVirtualCardResponse extends ToolResponse {
  output: {
    virtualCard: RampVirtualCard
  }
}

export interface RampListVendorsParams {
  accessToken: string
  name?: string
  external_vendor_id?: string
  vendor_owner_id?: string
  start?: string
  page_size?: number
}

export interface RampListVendorsResponse extends ToolResponse {
  output: {
    vendors: RampVendor[]
    nextCursor: string | null
    nextPageUrl: string | null
  }
}

export interface RampGetVendorParams {
  accessToken: string
  vendor_id: string
}

export interface RampGetVendorResponse extends ToolResponse {
  output: {
    vendor: RampVendor
  }
}

export interface RampListBillsParams {
  accessToken: string
  vendor_id?: string
  payment_status?: string
  approval_status?: string
  from_due_date?: string
  to_due_date?: string
  start?: string
  page_size?: number
}

export interface RampListBillsResponse extends ToolResponse {
  output: {
    bills: RampBill[]
    nextCursor: string | null
    nextPageUrl: string | null
  }
}

export interface RampGetBillParams {
  accessToken: string
  bill_id: string
}

export interface RampGetBillResponse extends ToolResponse {
  output: {
    bill: RampBill
  }
}

export interface RampListReimbursementsParams {
  accessToken: string
  user_id?: string
  reimbursement_state?: string
  from_date?: string
  to_date?: string
  sync_status?: string
  start?: string
  page_size?: number
}

export interface RampListReimbursementsResponse extends ToolResponse {
  output: {
    reimbursements: RampReimbursement[]
    nextCursor: string | null
    nextPageUrl: string | null
  }
}

export interface RampGetReimbursementParams {
  accessToken: string
  reimbursement_id: string
}

export interface RampGetReimbursementResponse extends ToolResponse {
  output: {
    reimbursement: RampReimbursement
  }
}

export interface RampGetMemoParams {
  accessToken: string
  transaction_id: string
}

export interface RampGetMemoResponse extends ToolResponse {
  output: {
    memo: RampMemo
  }
}

export interface RampCreateMemoParams {
  accessToken: string
  transaction_id: string
  memo: string
  is_memo_recurring?: boolean
}

export interface RampCreateMemoResponse extends ToolResponse {
  output: {
    memo: RampMemo
  }
}
