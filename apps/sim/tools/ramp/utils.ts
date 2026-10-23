import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecord } from '@sim/utils/object'
import type {
  RampAmount,
  RampBalance,
  RampBill,
  RampBillVendor,
  RampBusiness,
  RampCardHolder,
  RampCurrencyAmount,
  RampMemo,
  RampPhysicalCard,
  RampReimbursement,
  RampReimbursementAmount,
  RampTransaction,
  RampUser,
  RampVendor,
  RampVirtualCard,
} from '@/tools/ramp/types'

export function buildRampHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
}

export function appendRampPagination(
  query: URLSearchParams,
  params: { start?: string; page_size?: number }
): void {
  const pageSize = params.page_size ?? 20
  if (!Number.isInteger(pageSize) || pageSize < 2 || pageSize > 100) {
    throw new Error('Ramp page size must be an integer between 2 and 100')
  }
  query.set('page_size', String(pageSize))
  if (params.start?.trim()) query.set('start', params.start.trim())
}

export async function parseRampResponse(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json()
  if (!isRecordLike(payload)) throw new Error('Ramp returned an invalid response')
  if (!response.ok || payload.error_v2) {
    const error = toRecord(payload.error_v2)
    const message = toStringOrNull(error.message) ?? response.statusText
    throw new Error(`Ramp API error (${response.status}): ${message}`)
  }
  return payload
}

export function getRampPagination(data: Record<string, unknown>): {
  nextCursor: string | null
  nextPageUrl: string | null
} {
  const page = toRecord(data.page)
  const nextPageUrl = toStringOrNull(page.next)
  return {
    nextPageUrl,
    nextCursor: nextPageUrl ? new URL(nextPageUrl).searchParams.get('start') : null,
  }
}

function projectAmount(value: unknown): RampAmount {
  const data = toRecord(value)
  return {
    currency: toStringOrNull(data.currency),
    value: toNumberOrNull(data.value),
  }
}

function projectCurrencyAmount(value: unknown): RampCurrencyAmount {
  const data = toRecord(value)
  return {
    amount: toNumberOrNull(data.amount),
    currency_code: toStringOrNull(data.currency_code),
    minor_unit_conversion_rate: toNumberOrNull(data.minor_unit_conversion_rate),
  }
}

function projectReimbursementAmount(value: unknown): RampReimbursementAmount {
  const data = toRecord(value)
  return {
    currency: toStringOrNull(data.currency),
    value: toNumberOrNull(data.value),
    minor_unit_conversion_rate: toNumberOrNull(data.minor_unit_conversion_rate),
  }
}

function projectBillVendor(value: unknown): RampBillVendor {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    name: toStringOrNull(data.name),
    remote_id: toStringOrNull(data.remote_id),
    remote_name: toStringOrNull(data.remote_name),
    type: toStringOrNull(data.type),
  }
}

function projectCardHolder(value: unknown): RampCardHolder {
  const data = toRecord(value)
  return {
    user_id: toStringOrNull(data.user_id),
    first_name: toStringOrNull(data.first_name),
    last_name: toStringOrNull(data.last_name),
    department_id: toStringOrNull(data.department_id),
    department_name: toStringOrNull(data.department_name),
  }
}

export function projectBusiness(value: unknown): RampBusiness {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    business_name_legal: toStringOrNull(data.business_name_legal),
    business_name_on_card: toStringOrNull(data.business_name_on_card),
    active: toBooleanOrNull(data.active),
    created_time: toStringOrNull(data.created_time),
    website: toStringOrNull(data.website),
    is_reimbursements_enabled: toBooleanOrNull(data.is_reimbursements_enabled),
    initial_approved_limit_amount:
      data.initial_approved_limit_amount == null
        ? null
        : projectAmount(data.initial_approved_limit_amount),
  }
}

export function projectBalance(value: unknown): RampBalance {
  const data = toRecord(value)
  return {
    card_limit_amount:
      data.card_limit_amount == null ? null : projectCurrencyAmount(data.card_limit_amount),
    available_card_limit_amount:
      data.available_card_limit_amount == null
        ? null
        : projectCurrencyAmount(data.available_card_limit_amount),
    card_balance_including_pending_amount:
      data.card_balance_including_pending_amount == null
        ? null
        : projectCurrencyAmount(data.card_balance_including_pending_amount),
    card_balance_excluding_pending_amount:
      data.card_balance_excluding_pending_amount == null
        ? null
        : projectCurrencyAmount(data.card_balance_excluding_pending_amount),
    statement_balance_amount:
      data.statement_balance_amount == null
        ? null
        : projectCurrencyAmount(data.statement_balance_amount),
    next_billing_date: toStringOrNull(data.next_billing_date),
    prev_billing_date: toStringOrNull(data.prev_billing_date),
  }
}

export function projectUser(value: unknown): RampUser {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    first_name: toStringOrNull(data.first_name),
    last_name: toStringOrNull(data.last_name),
    email: toStringOrNull(data.email),
    role: toStringOrNull(data.role),
    status: toStringOrNull(data.status),
    employee_id: toStringOrNull(data.employee_id),
    department_id: toStringOrNull(data.department_id),
    location_id: toStringOrNull(data.location_id),
    manager_id: toStringOrNull(data.manager_id),
    entity_id: toStringOrNull(data.entity_id),
    is_manager: toBooleanOrNull(data.is_manager),
  }
}

export function projectTransaction(value: unknown): RampTransaction {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    entity_amount: data.entity_amount == null ? null : projectAmount(data.entity_amount),
    merchant_amount: data.merchant_amount == null ? null : projectAmount(data.merchant_amount),
    merchant_name: toStringOrNull(data.merchant_name),
    merchant_descriptor: toStringOrNull(data.merchant_descriptor),
    merchant_category_code: toStringOrNull(data.merchant_category_code),
    memo: toStringOrNull(data.memo),
    state: toStringOrNull(data.state),
    card_id: toStringOrNull(data.card_id),
    card_holder: data.card_holder == null ? null : projectCardHolder(data.card_holder),
    user_transaction_time: toStringOrNull(data.user_transaction_time),
    settlement_date: toStringOrNull(data.settlement_date),
    all_requirements_met_and_approved: toBooleanOrNull(data.all_requirements_met_and_approved),
    sync_status: toStringOrNull(data.sync_status),
    entity_id: toStringOrNull(data.entity_id),
    updated_at: toStringOrNull(data.updated_at),
  }
}

export function projectPhysicalCard(value: unknown): RampPhysicalCard {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    cardholder_id: toStringOrNull(data.cardholder_id),
    cardholder_name: toStringOrNull(data.cardholder_name),
    display_name: toStringOrNull(data.display_name),
    last_four: toStringOrNull(data.last_four),
    state: toStringOrNull(data.state),
    is_suspended: toBooleanOrNull(data.is_suspended),
    fund_id: toStringOrNull(data.fund_id),
    created_at: toStringOrNull(data.created_at),
  }
}

export function projectVirtualCard(value: unknown): RampVirtualCard {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    user_id: toStringOrNull(data.user_id),
    fund_id: toStringOrNull(data.fund_id),
    is_card_suspended: toBooleanOrNull(data.is_card_suspended),
    created_at: toStringOrNull(data.created_at),
  }
}

export function projectVendor(value: unknown): RampVendor {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    name: toStringOrNull(data.name),
    name_legal: toStringOrNull(data.name_legal),
    description: toStringOrNull(data.description),
    is_active: toBooleanOrNull(data.is_active),
    external_vendor_id: toStringOrNull(data.external_vendor_id),
    accounting_vendor_remote_id: toStringOrNull(data.accounting_vendor_remote_id),
    vendor_owner_id: toStringOrNull(data.vendor_owner_id),
    country: toStringOrNull(data.country),
    created_at: toStringOrNull(data.created_at),
    total_spend_all_time:
      data.total_spend_all_time == null ? null : projectCurrencyAmount(data.total_spend_all_time),
    total_spend_last_30_days:
      data.total_spend_last_30_days == null
        ? null
        : projectCurrencyAmount(data.total_spend_last_30_days),
    total_spend_ytd:
      data.total_spend_ytd == null ? null : projectCurrencyAmount(data.total_spend_ytd),
  }
}

export function projectBill(value: unknown): RampBill {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    invoice_number: toStringOrNull(data.invoice_number),
    amount: data.amount == null ? null : projectCurrencyAmount(data.amount),
    vendor: data.vendor == null ? null : projectBillVendor(data.vendor),
    memo: toStringOrNull(data.memo),
    status: toStringOrNull(data.status),
    status_summary: toStringOrNull(data.status_summary),
    approval_status: toStringOrNull(data.approval_status),
    sync_status: toStringOrNull(data.sync_status),
    due_at: toStringOrNull(data.due_at),
    issued_at: toStringOrNull(data.issued_at),
    paid_at: toStringOrNull(data.paid_at),
    created_at: toStringOrNull(data.created_at),
    entity_id: toStringOrNull(data.entity_id),
  }
}

export function projectReimbursement(value: unknown): RampReimbursement {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    user_id: toStringOrNull(data.user_id),
    user_email: toStringOrNull(data.user_email),
    user_full_name: toStringOrNull(data.user_full_name),
    entity_amount:
      data.entity_amount == null ? null : projectReimbursementAmount(data.entity_amount),
    merchant_amount:
      data.merchant_amount == null ? null : projectReimbursementAmount(data.merchant_amount),
    merchant: toStringOrNull(data.merchant),
    memo: toStringOrNull(data.memo),
    state: toStringOrNull(data.state),
    direction: toStringOrNull(data.direction),
    type: toStringOrNull(data.type),
    transaction_date: toStringOrNull(data.transaction_date),
    created_at: toStringOrNull(data.created_at),
    submitted_at: toStringOrNull(data.submitted_at),
    approved_at: toStringOrNull(data.approved_at),
    payment_processed_at: toStringOrNull(data.payment_processed_at),
    sync_status: toStringOrNull(data.sync_status),
    entity_id: toStringOrNull(data.entity_id),
  }
}

export function projectMemo(value: unknown): RampMemo {
  const data = toRecord(value)
  return {
    id: toStringOrNull(data.id),
    memo: toStringOrNull(data.memo),
  }
}
