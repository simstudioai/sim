import type { UserFileLike } from '@/lib/core/utils/user-file'
import type { ToolResponse } from '@/tools/types'

/**
 * Canonical monetary value used across the Ramp API. The amount is an integer
 * in the smallest denomination of the currency (e.g. cents for USD).
 */
export interface RampCurrencyAmount {
  amount: number
  currency_code: string
  minor_unit_conversion_rate: number | null
}

export interface RampTransaction {
  id: string
  amount: number
  currency_code?: string
  merchant_name: string | null
  merchant_id: string | null
  merchant_category_code?: string
  merchant_category_code_description?: string
  memo: string | null
  state: string
  sync_status?: string
  user_transaction_time: string
  settlement_date?: string
  accounting_date?: string | null
  card_id?: string
  card_holder?: {
    user_id?: string
    first_name?: string
    last_name?: string
    department_id?: string
    department_name?: string
    location_id?: string
    location_name?: string
  }
  receipts?: string[]
  entity_id?: string | null
  limit_id?: string
  spend_program_id?: string
  statement_id?: string
  trip_id?: string | null
  sk_category_id?: number | null
  sk_category_name?: string | null
  original_transaction_amount?: RampCurrencyAmount | null
}

export interface RampUser {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
  status: string
  is_manager?: boolean
  manager_id?: string | null
  department_id?: string | null
  location_id?: string | null
  entity_id?: string | null
  employee_id?: string | null
  phone?: string | null
}

export interface RampCard {
  id: string
  display_name: string
  last_four: string
  cardholder_id: string
  cardholder_name: string
  is_physical: boolean
  state: string
  expiration: string
  created_at: string
  entity_id?: string
  card_program_id?: string | null
}

export interface RampLimit {
  id: string
  display_name: string
  state: string
  balance?: {
    cleared?: RampCurrencyAmount
    pending?: RampCurrencyAmount
    total?: RampCurrencyAmount
  } | null
  cards?: Array<{ card_id?: string; expiration?: string; last_four?: string; via?: string }>
  users?: Array<{ user_id?: string }>
  spend_program_id?: string | null
  entity_id?: string | null
  is_shareable?: boolean
  created_at?: string
}

export interface RampReimbursement {
  id: string
  amount: number | null
  currency: string
  merchant: string | null
  memo: string | null
  state: string
  type: string
  direction?: string
  user_id: string
  user_full_name: string
  user_email: string
  created_at: string
  submitted_at?: string | null
  approved_at?: string | null
  transaction_date?: string | null
  payment_processed_at?: string | null
  receipts?: string[]
  trip_id?: string | null
  entity_id?: string | null
  original_reimbursement_amount?: RampCurrencyAmount | null
}

export interface RampBill {
  id: string
  invoice_number: string
  amount: RampCurrencyAmount
  status: string
  payment_status?: string
  due_at: string
  issued_at: string
  paid_at?: string
  created_at: string
  memo?: string
  vendor?: {
    remote_name?: string
    type?: string
    vendor_id?: string | null
    vendor_owner_id?: string | null
  }
  entity_id?: string
  deep_link_url?: string
  accounting_date?: string
  invoice_urls?: string[]
}

export interface RampDepartment {
  id: string
  name: string
}

export interface RampVendor {
  id: string
  name: string
  name_legal?: string
  state: string
  is_active?: boolean
  country?: string
  description?: string
  merchant_id?: string
  sk_category_id?: number
  sk_category_name?: string
  created_at?: string
  total_spend_ytd?: RampCurrencyAmount
  total_spend_all_time?: RampCurrencyAmount
  vendor_owner_id?: string | null
}

export interface RampBusiness {
  id: string
  business_name_legal: string
  business_name_on_card: string
  active: boolean
  created_time: string
  enforce_sso?: boolean
  is_reimbursements_enabled: boolean
  is_integrated_with_slack?: boolean
  initial_approved_limit?: number
  limit_locked?: boolean
  phone?: string
  website?: string
  billing_address?: Record<string, string>
}

export interface RampBusinessBalance {
  balance_including_pending?: number
  balance_including_pending_amount?: RampCurrencyAmount
  card_balance_including_pending?: number
  card_balance_including_pending_amount?: RampCurrencyAmount
  card_balance_excluding_pending?: number
  card_balance_excluding_pending_amount?: RampCurrencyAmount
  card_limit?: number
  card_limit_amount?: RampCurrencyAmount
  available_card_limit?: number
  available_card_limit_amount?: RampCurrencyAmount
  flex_balance?: number
  flex_balance_amount?: RampCurrencyAmount
  available_flex_limit?: number
  available_flex_limit_amount?: RampCurrencyAmount
  statement_balance?: number
  statement_balance_amount?: RampCurrencyAmount
}

export interface RampEntity {
  id: string
  entity_name: string
  currency?: string
  is_primary?: boolean
  location_ids?: string[]
  accounts?: unknown[]
  payment_accounts?: unknown[]
}

export interface RampSpendProgram {
  id: string
  display_name: string
  description?: string
  icon?: string
  is_shareable?: boolean
  issue_physical_card_if_needed?: boolean
  permitted_spend_types?: {
    primary_card_enabled?: boolean
    reimbursements_enabled?: boolean
  }
  restrictions?: Record<string, unknown> | null
}

export interface RampReceipt {
  id: string
  receipt_url: string
  transaction_id?: string
  user_id?: string
  created_at?: string
}

interface RampBaseParams {
  accessToken?: string
}

interface RampListParams extends RampBaseParams {
  pageSize?: number
  start?: string
}

export interface RampListTransactionsParams extends RampListParams {
  userId?: string
  cardId?: string
  departmentId?: string
  merchantId?: string
  state?: string
  minAmount?: number
  maxAmount?: number
  fromDate?: string
  toDate?: string
}

export interface RampListTransactionsResponse extends ToolResponse {
  output: {
    transactions?: RampTransaction[]
    nextStart?: string | null
  }
}

export interface RampGetTransactionParams extends RampBaseParams {
  transactionId: string
}

export interface RampGetTransactionResponse extends ToolResponse {
  output: {
    transaction?: RampTransaction
  }
}

export interface RampListUsersParams extends RampListParams {
  email?: string
  departmentId?: string
}

export interface RampListUsersResponse extends ToolResponse {
  output: {
    users?: RampUser[]
    nextStart?: string | null
  }
}

export interface RampGetUserParams extends RampBaseParams {
  userId: string
}

export interface RampGetUserResponse extends ToolResponse {
  output: {
    user?: RampUser
  }
}

export interface RampListCardsParams extends RampListParams {
  userId?: string
  displayName?: string
}

export interface RampListCardsResponse extends ToolResponse {
  output: {
    cards?: RampCard[]
    nextStart?: string | null
  }
}

export interface RampGetCardParams extends RampBaseParams {
  cardId: string
}

export interface RampGetCardResponse extends ToolResponse {
  output: {
    card?: RampCard
  }
}

export interface RampListLimitsParams extends RampListParams {
  userId?: string
  cardId?: string
}

export interface RampListLimitsResponse extends ToolResponse {
  output: {
    limits?: RampLimit[]
    nextStart?: string | null
  }
}

export interface RampListReimbursementsParams extends RampListParams {
  userId?: string
  fromDate?: string
  toDate?: string
}

export interface RampListReimbursementsResponse extends ToolResponse {
  output: {
    reimbursements?: RampReimbursement[]
    nextStart?: string | null
  }
}

export interface RampGetReimbursementParams extends RampBaseParams {
  reimbursementId: string
}

export interface RampGetReimbursementResponse extends ToolResponse {
  output: {
    reimbursement?: RampReimbursement
  }
}

export interface RampListBillsParams extends RampListParams {
  vendorId?: string
}

export interface RampListBillsResponse extends ToolResponse {
  output: {
    bills?: RampBill[]
    nextStart?: string | null
  }
}

export interface RampGetBillParams extends RampBaseParams {
  billId: string
}

export interface RampGetBillResponse extends ToolResponse {
  output: {
    bill?: RampBill
  }
}

export interface RampListDepartmentsParams extends RampListParams {}

export interface RampListDepartmentsResponse extends ToolResponse {
  output: {
    departments?: RampDepartment[]
    nextStart?: string | null
  }
}

export interface RampListVendorsParams extends RampListParams {
  vendorName?: string
}

export interface RampListVendorsResponse extends ToolResponse {
  output: {
    vendors?: RampVendor[]
    nextStart?: string | null
  }
}

export interface RampListReceiptsParams extends RampListParams {
  transactionId?: string
  fromDate?: string
  toDate?: string
}

export interface RampListReceiptsResponse extends ToolResponse {
  output: {
    receipts?: RampReceipt[]
    nextStart?: string | null
  }
}

export interface RampGetReceiptParams extends RampBaseParams {
  receiptId: string
}

export interface RampGetReceiptResponse extends ToolResponse {
  output: {
    receipt?: RampReceipt
  }
}

export interface RampGetBusinessParams extends RampBaseParams {}

export interface RampGetBusinessResponse extends ToolResponse {
  output: {
    business?: RampBusiness
  }
}

export interface RampGetBusinessBalanceParams extends RampBaseParams {}

export interface RampGetBusinessBalanceResponse extends ToolResponse {
  output: {
    balance?: RampBusinessBalance
  }
}

export interface RampGetLimitParams extends RampBaseParams {
  limitId: string
}

export interface RampGetLimitResponse extends ToolResponse {
  output: {
    limit?: RampLimit
  }
}

export interface RampGetDepartmentParams extends RampBaseParams {
  departmentId: string
}

export interface RampGetDepartmentResponse extends ToolResponse {
  output: {
    department?: RampDepartment
  }
}

export interface RampCreateDepartmentParams extends RampBaseParams {
  departmentName: string
}

export interface RampCreateDepartmentResponse extends ToolResponse {
  output: {
    department?: RampDepartment
  }
}

export interface RampGetVendorParams extends RampBaseParams {
  vendorId: string
}

export interface RampGetVendorResponse extends ToolResponse {
  output: {
    vendor?: RampVendor
  }
}

export interface RampListEntitiesParams extends RampListParams {
  entityName?: string
}

export interface RampListEntitiesResponse extends ToolResponse {
  output: {
    entities?: RampEntity[]
    nextStart?: string | null
  }
}

export interface RampListSpendProgramsParams extends RampListParams {}

export interface RampListSpendProgramsResponse extends ToolResponse {
  output: {
    spendPrograms?: RampSpendProgram[]
    nextStart?: string | null
  }
}

export interface RampGetSpendProgramParams extends RampBaseParams {
  spendProgramId: string
}

export interface RampGetSpendProgramResponse extends ToolResponse {
  output: {
    spendProgram?: RampSpendProgram
  }
}

export interface RampUploadReceiptParams extends RampBaseParams {
  userId: string
  transactionId?: string
  file?: UserFileLike
}

export interface RampUploadReceiptResponse extends ToolResponse {
  output: {
    receiptId?: string
  }
}

export type RampResponse =
  | RampListTransactionsResponse
  | RampGetTransactionResponse
  | RampListUsersResponse
  | RampGetUserResponse
  | RampListCardsResponse
  | RampGetCardResponse
  | RampListLimitsResponse
  | RampGetLimitResponse
  | RampListReimbursementsResponse
  | RampGetReimbursementResponse
  | RampListBillsResponse
  | RampGetBillResponse
  | RampListDepartmentsResponse
  | RampGetDepartmentResponse
  | RampCreateDepartmentResponse
  | RampListVendorsResponse
  | RampGetVendorResponse
  | RampListEntitiesResponse
  | RampListSpendProgramsResponse
  | RampGetSpendProgramResponse
  | RampGetBusinessResponse
  | RampGetBusinessBalanceResponse
  | RampListReceiptsResponse
  | RampGetReceiptResponse
  | RampUploadReceiptResponse
