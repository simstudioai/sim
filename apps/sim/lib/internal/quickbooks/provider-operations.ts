import { filterUndefined } from '@sim/utils/object'
import {
  buildQuickBooksCreateBillPaymentBody,
  buildQuickBooksUpdateBillBody,
  buildQuickBooksUpdateBillPaymentBody,
  buildQuickBooksUpdatePurchaseBody,
  buildQuickBooksUpdatePurchaseOrderBody,
  buildQuickBooksUpdateVendorCreditBody,
} from '@/tools/quickbooks/purchasing_utils'
import {
  buildQuickBooksUpdatePaymentBody,
  buildQuickBooksUpdateSalesDocumentBody,
  parseQuickBooksInvoiceAllocations,
} from '@/tools/quickbooks/sales_utils'
import type {
  QuickBooksAccount,
  QuickBooksCreateBillPaymentParams,
  QuickBooksItem,
  QuickBooksPurchasingTransaction,
  QuickBooksSalesTransaction,
  QuickBooksUpdateBillParams,
  QuickBooksUpdateBillPaymentParams,
  QuickBooksUpdateCustomerPaymentParams,
  QuickBooksUpdateEmployeeParams,
  QuickBooksUpdateItemParams,
  QuickBooksUpdatePurchaseOrderParams,
  QuickBooksUpdatePurchaseParams,
  QuickBooksUpdateRefundReceiptParams,
  QuickBooksUpdateSalesDocumentParams,
  QuickBooksUpdateVendorCreditParams,
  QuickBooksUpdateVendorParams,
  QuickBooksVendor,
} from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  buildQuickBooksFullUpdateBody,
  executeQuickBooksFullUpdate,
  getQuickBooksOperationError,
  getQuickBooksToolHeaders,
  sanitizeQuickBooksEmployee,
  sanitizeQuickBooksVendor,
  transformQuickBooksEntityResponse,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import {
  assertQuickBooksSparseUpdate,
  optionalQuickBooksString,
  parseQuickBooksAddress,
  quickBooksActiveValue,
  quickBooksEmailAddress,
  quickBooksPhoneNumber,
  quickBooksReference,
  requiredQuickBooksString,
  validateQuickBooksOptionalNumber,
} from '@/tools/quickbooks/values'

/**
 * Intuit constrains the BillPayment payment account by both classification
 * fields, not by `AccountType` alone. `BillPaymentCheck.BankAccountRef`: "The
 * specified account must have `Account.AccountType` set to `Bank` and
 * `Account.AccountSubType` set to `Checking`."
 * `BillPaymentCreditCard.CCAccountRef`: "The specified account must have
 * `Account.AccountType` set to `Credit Card` and `Account.AccountSubType` set
 * to `CreditCard`."
 */
const QUICKBOOKS_BILL_PAYMENT_ACCOUNTS = {
  check: { label: 'Check', accountType: 'Bank', accountSubType: 'Checking' },
  credit_card: { label: 'Credit-card', accountType: 'Credit Card', accountSubType: 'CreditCard' },
} as const satisfies Record<
  QuickBooksCreateBillPaymentParams['paymentType'],
  { label: string; accountType: string; accountSubType: string }
>

function assertCompatiblePaymentAccount(
  account: QuickBooksAccount,
  paymentType: QuickBooksCreateBillPaymentParams['paymentType'],
  paymentAccountId: string
): void {
  const accountId = account.Id.trim()
  if (accountId !== paymentAccountId) {
    throw new Error('QuickBooks returned a different payment account than requested')
  }
  if (account.Active === false) {
    throw new Error('QuickBooks payment account is inactive. Select an active account.')
  }

  const expected = QUICKBOOKS_BILL_PAYMENT_ACCOUNTS[paymentType]
  if (!expected) {
    throw new Error(`Unsupported QuickBooks bill payment type: ${String(paymentType)}`)
  }
  if (account.AccountType !== expected.accountType) {
    throw new Error(
      `${expected.label} Bill Payments require a QuickBooks ${expected.accountType} account. Account ${paymentAccountId} is ${account.AccountType || 'missing an account type'}.`
    )
  }
  if (account.AccountSubType !== expected.accountSubType) {
    throw new Error(
      `${expected.label} Bill Payments require a QuickBooks ${expected.accountType} account with the ${expected.accountSubType} sub-type. Account ${paymentAccountId} is ${account.AccountSubType || 'missing an account sub-type'}.`
    )
  }
}

function buildQuickBooksUpdateVendorBody(
  params: QuickBooksUpdateVendorParams
): Record<string, unknown> {
  const body = filterUndefined({
    Id: requiredQuickBooksString(params.vendorId, 'vendorId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    DisplayName: optionalQuickBooksString(params.displayName),
    CompanyName: optionalQuickBooksString(params.companyName),
    GivenName: optionalQuickBooksString(params.givenName),
    FamilyName: optionalQuickBooksString(params.familyName),
    PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
    PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
    BillAddr: parseQuickBooksAddress(params.billingAddress, 'billingAddress'),
    PrintOnCheckName: optionalQuickBooksString(params.printOnCheckName),
    AcctNum: optionalQuickBooksString(params.accountNumber),
    Vendor1099: params.vendor1099,
    Active: quickBooksActiveValue(params.activeStatus),
  }) as Record<string, unknown>
  assertQuickBooksSparseUpdate(body)
  return body
}

function buildQuickBooksUpdateEmployeeBody(
  params: QuickBooksUpdateEmployeeParams
): Record<string, unknown> {
  const body = filterUndefined({
    Id: requiredQuickBooksString(params.employeeId, 'employeeId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    DisplayName: optionalQuickBooksString(params.displayName),
    GivenName: optionalQuickBooksString(params.givenName),
    FamilyName: optionalQuickBooksString(params.familyName),
    PrimaryEmailAddr: quickBooksEmailAddress(params.primaryEmail),
    PrimaryPhone: quickBooksPhoneNumber(params.primaryPhone),
    PrimaryAddr: parseQuickBooksAddress(params.primaryAddress, 'primaryAddress'),
    PrintOnCheckName: optionalQuickBooksString(params.printOnCheckName),
    BillableTime: params.billableTime,
    Active: quickBooksActiveValue(params.activeStatus),
  }) as Record<string, unknown>
  assertQuickBooksSparseUpdate(body)
  return body
}

function buildQuickBooksUpdateItemBody(
  params: QuickBooksUpdateItemParams
): Record<string, unknown> {
  const body = filterUndefined({
    Id: requiredQuickBooksString(params.itemId, 'itemId'),
    SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
    sparse: true,
    Name: optionalQuickBooksString(params.name),
    IncomeAccountRef: params.incomeAccountId
      ? quickBooksReference(params.incomeAccountId, 'incomeAccountId')
      : undefined,
    Description: optionalQuickBooksString(params.description),
    UnitPrice: validateQuickBooksOptionalNumber(params.unitPrice, 'unitPrice'),
    PurchaseDesc: optionalQuickBooksString(params.purchaseDescription),
    PurchaseCost: validateQuickBooksOptionalNumber(params.purchaseCost, 'purchaseCost'),
    ExpenseAccountRef: params.expenseAccountId
      ? quickBooksReference(params.expenseAccountId, 'expenseAccountId')
      : undefined,
    Taxable: params.taxable,
    Active: quickBooksActiveValue(params.activeStatus),
  }) as Record<string, unknown>
  assertQuickBooksSparseUpdate(body)
  return body
}

export async function executeQuickBooksCreateBillPaymentOperation(
  params: QuickBooksCreateBillPaymentParams,
  signal?: AbortSignal
) {
  const body = buildQuickBooksCreateBillPaymentBody(params)
  const paymentAccountId = params.paymentAccountId.trim()
  if (!paymentAccountId) throw new Error('paymentAccountId is required')

  const accountResponse = await fetch(
    buildQuickBooksEntityUrl(params, 'account', paymentAccountId),
    {
      method: 'GET',
      headers: getQuickBooksToolHeaders(params.accessToken),
      signal,
    }
  )
  if (!accountResponse.ok) {
    throw await getQuickBooksOperationError(accountResponse, 'BillPayment', signal)
  }
  const { item: account } = await transformQuickBooksEntityResponse<QuickBooksAccount>(
    accountResponse,
    'Account',
    signal
  )
  assertCompatiblePaymentAccount(account, params.paymentType, paymentAccountId)
  signal?.throwIfAborted()

  const paymentResponse = await fetch(
    addQuickBooksRequestId(buildQuickBooksEntityUrl(params, 'billpayment'), params.requestId),
    {
      method: 'POST',
      headers: getQuickBooksToolHeaders(params.accessToken, 'application/json'),
      body: JSON.stringify(body),
      signal,
    }
  )
  if (!paymentResponse.ok) {
    throw await getQuickBooksOperationError(paymentResponse, 'BillPayment', signal)
  }
  return transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(
    paymentResponse,
    'BillPayment',
    undefined,
    signal
  )
}

export function executeQuickBooksUpdateBillOperation(
  params: QuickBooksUpdateBillParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate({
    params,
    signal,
    entity: 'Bill',
    resource: 'bill',
    recordId: params.billId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdateBillBody,
  })
}

export function executeQuickBooksUpdateBillPaymentOperation(
  params: QuickBooksUpdateBillPaymentParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate({
    params,
    signal,
    entity: 'BillPayment',
    resource: 'billpayment',
    recordId: params.billPaymentId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdateBillPaymentBody,
  })
}

export function executeQuickBooksUpdateCreditMemoOperation(
  params: QuickBooksUpdateSalesDocumentParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate({
    params,
    signal,
    entity: 'CreditMemo',
    resource: 'creditmemo',
    recordId: params.transactionId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdateSalesDocumentBody,
  })
}

/**
 * Intuit documents `RefundReceipt::UPDATE "Sparse update a refund receipt"`:
 * "Sparse updating provides the ability to update a subset of properties for a
 * given object; only elements specified in the request are updated. Missing
 * elements are left untouched." The sparse operation is posted directly, so no
 * read-merge-write round trip is needed to preserve untouched fields.
 */
export async function executeQuickBooksUpdateRefundReceiptOperation(
  params: QuickBooksUpdateRefundReceiptParams,
  signal?: AbortSignal
) {
  const response = await fetch(buildQuickBooksEntityUrl(params, 'refundreceipt'), {
    method: 'POST',
    headers: getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: JSON.stringify(buildQuickBooksUpdateSalesDocumentBody(params)),
    signal,
  })
  if (!response.ok) {
    throw await getQuickBooksOperationError(response, 'RefundReceipt', signal)
  }
  return transformQuickBooksMutationResponse<QuickBooksSalesTransaction>(
    response,
    'RefundReceipt',
    undefined,
    signal
  )
}

/** Preserves QuickBooks' all-or-none Payment lines across a full update. */
export async function executeQuickBooksUpdateCustomerPaymentOperation(
  params: QuickBooksUpdateCustomerPaymentParams,
  signal?: AbortSignal
) {
  const paymentId = params.paymentId?.trim()
  if (!paymentId) throw new Error('paymentId is required')
  parseQuickBooksInvoiceAllocations(params.invoiceAllocations)

  const syncToken = params.syncToken?.trim()
  if (!syncToken) throw new Error('syncToken is required')
  const readResponse = await fetch(buildQuickBooksEntityUrl(params, 'payment', paymentId), {
    method: 'GET',
    headers: getQuickBooksToolHeaders(params.accessToken),
    signal,
  })
  if (!readResponse.ok) {
    throw await getQuickBooksOperationError(readResponse, 'Payment', signal)
  }
  const { item: currentPayment } =
    await transformQuickBooksEntityResponse<QuickBooksSalesTransaction>(
      readResponse,
      'Payment',
      signal
    )
  const currentId = typeof currentPayment.Id === 'string' ? currentPayment.Id.trim() : ''
  const currentSyncToken =
    typeof currentPayment.SyncToken === 'string' ? currentPayment.SyncToken.trim() : ''
  if (currentId !== paymentId) {
    throw new Error('QuickBooks Payment read returned an unexpected record ID')
  }
  if (currentSyncToken !== syncToken) {
    throw new Error(
      `QuickBooks payment ${paymentId} changed since sync token ${syncToken} was read (current sync token ${currentSyncToken}). Re-read the payment and retry.`
    )
  }
  signal?.throwIfAborted()

  const patch = buildQuickBooksUpdatePaymentBody(params, currentPayment)
  const fullBody = buildQuickBooksFullUpdateBody(
    currentPayment as QuickBooksSalesTransaction & Record<string, unknown>,
    patch,
    paymentId,
    syncToken
  )
  const updateResponse = await fetch(buildQuickBooksEntityUrl(params, 'payment'), {
    method: 'POST',
    headers: getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: JSON.stringify(fullBody),
    signal,
  })
  if (!updateResponse.ok) {
    throw await getQuickBooksOperationError(updateResponse, 'Payment', signal)
  }
  return transformQuickBooksMutationResponse<QuickBooksSalesTransaction>(
    updateResponse,
    'Payment',
    undefined,
    signal
  )
}

export function executeQuickBooksUpdateEmployeeOperation(
  params: QuickBooksUpdateEmployeeParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate({
    params,
    signal,
    entity: 'Employee',
    resource: 'employee',
    recordId: params.employeeId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdateEmployeeBody,
    sanitize: sanitizeQuickBooksEmployee,
  })
}

export function executeQuickBooksUpdateItemOperation(
  params: QuickBooksUpdateItemParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate<QuickBooksUpdateItemParams, QuickBooksItem>({
    params,
    signal,
    entity: 'Item',
    resource: 'item',
    recordId: params.itemId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdateItemBody,
  })
}

export function executeQuickBooksUpdatePurchaseOperation(
  params: QuickBooksUpdatePurchaseParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate({
    params,
    signal,
    entity: 'Purchase',
    resource: 'purchase',
    recordId: params.purchaseId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdatePurchaseBody,
  })
}

export function executeQuickBooksUpdatePurchaseOrderOperation(
  params: QuickBooksUpdatePurchaseOrderParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate({
    params,
    signal,
    entity: 'PurchaseOrder',
    resource: 'purchaseorder',
    recordId: params.purchaseOrderId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdatePurchaseOrderBody,
  })
}

export function executeQuickBooksUpdateVendorOperation(
  params: QuickBooksUpdateVendorParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate<QuickBooksUpdateVendorParams, QuickBooksVendor>({
    params,
    signal,
    entity: 'Vendor',
    resource: 'vendor',
    recordId: params.vendorId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdateVendorBody,
    sanitize: sanitizeQuickBooksVendor,
  })
}

export function executeQuickBooksUpdateVendorCreditOperation(
  params: QuickBooksUpdateVendorCreditParams,
  signal?: AbortSignal
) {
  return executeQuickBooksFullUpdate({
    params,
    signal,
    entity: 'VendorCredit',
    resource: 'vendorcredit',
    recordId: params.vendorCreditId,
    syncToken: params.syncToken,
    buildPatch: buildQuickBooksUpdateVendorCreditBody,
  })
}
