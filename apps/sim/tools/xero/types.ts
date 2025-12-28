/**
 * Xero API Types
 * Using xero-node SDK for type-safe Xero integrations
 */

import type { ToolResponse } from '@/tools/types'

// ============================================================================
// Shared Types
// ============================================================================

export interface XeroContact {
  ContactID: string
  ContactNumber?: string
  AccountNumber?: string
  Name: string
  FirstName?: string
  LastName?: string
  EmailAddress?: string
  Addresses?: Array<{
    AddressType: string
    City?: string
    Region?: string
    PostalCode?: string
    Country?: string
  }>
  Phones?: Array<{
    PhoneType: string
    PhoneNumber: string
  }>
  IsSupplier?: boolean
  IsCustomer?: boolean
}

export interface XeroInvoice {
  InvoiceID: string
  InvoiceNumber: string
  Type: 'ACCREC' | 'ACCPAY'  // ACCREC = Accounts Receivable (sales), ACCPAY = Accounts Payable (bills)
  Contact: XeroContact
  Status: string
  LineItems: Array<{
    Description: string
    Quantity: number
    UnitAmount: number
    AccountCode?: string
    TaxType?: string
    LineAmount: number
  }>
  DateString: string
  DueDateString?: string
  Total: number
  TotalTax: number
  SubTotal: number
  AmountDue: number
  AmountPaid: number
  CurrencyCode: string
}

export interface XeroBankTransaction {
  BankTransactionID: string
  Type: string
  Contact: XeroContact
  LineItems: Array<{
    Description: string
    Quantity: number
    UnitAmount: number
    AccountCode: string
  }>
  BankAccount: {
    AccountID: string
    Code: string
    Name: string
  }
  DateString: string
  Status: string
  Total: number
}

export interface XeroItem {
  ItemID: string
  Code: string
  Name: string
  Description?: string
  PurchaseDetails?: {
    UnitPrice: number
    AccountCode: string
  }
  SalesDetails?: {
    UnitPrice: number
    AccountCode: string
  }
  IsSold: boolean
  IsPurchased: boolean
  QuantityOnHand?: number
}

export interface XeroPurchaseOrder {
  PurchaseOrderID: string
  PurchaseOrderNumber: string
  Contact: XeroContact
  LineItems: Array<{
    Description: string
    Quantity: number
    UnitAmount: number
    AccountCode?: string
  }>
  DateString: string
  DeliveryDateString?: string
  Status: string
  SubTotal: number
  TotalTax: number
  Total: number
}

// ============================================================================
// Tool Parameter Types
// ============================================================================

export interface CreateInvoiceParams {
  apiKey: string
  tenantId: string
  contactId: string
  type?: 'ACCREC' | 'ACCPAY'
  dueDate?: string
  lines: Array<{
    description: string
    quantity: number
    unitAmount: number
    accountCode?: string
  }>
  reference?: string
}

export interface CreateBillParams {
  apiKey: string
  tenantId: string
  supplierId: string
  dueDate?: string
  lines: Array<{
    description: string
    quantity: number
    unitAmount: number
    accountCode?: string
  }>
  reference?: string
}

export interface ReconcileBankTransactionParams {
  apiKey: string
  tenantId: string
  bankAccountId: string
  date: string
  amount: number
  payee?: string
  description?: string
  accountCode?: string
  matchExisting?: boolean
}

export interface TrackInventoryParams {
  apiKey: string
  tenantId: string
  itemCode: string
  quantityChange: number
  transactionType: 'sale' | 'purchase' | 'adjustment'
  unitCost?: number
  description?: string
}

export interface CreatePurchaseOrderParams {
  apiKey: string
  tenantId: string
  supplierId: string
  deliveryDate?: string
  lines: Array<{
    description: string
    quantity: number
    unitAmount: number
    accountCode?: string
  }>
  reference?: string
}

// ============================================================================
// Tool Response Types
// ============================================================================

export interface CreateInvoiceResponse extends ToolResponse {
  output: {
    invoice: {
      id: string
      invoice_number: string
      type: string
      contact_name: string
      amount_due: number
      currency: string
      status: string
      created: string
      due_date: string | null
    }
    lines: Array<{
      description: string
      quantity: number
      unit_amount: number
      total: number
    }>
    metadata: {
      invoice_id: string
      invoice_number: string
      total_amount: number
      status: string
    }
  }
}

export interface CreateBillResponse extends ToolResponse {
  output: {
    bill: {
      id: string
      invoice_number: string
      supplier_name: string
      amount_due: number
      currency: string
      status: string
      created: string
      due_date: string | null
    }
    lines: Array<{
      description: string
      quantity: number
      unit_amount: number
      total: number
    }>
    metadata: {
      bill_id: string
      supplier_id: string
      total_amount: number
      status: string
    }
  }
}

export interface ReconcileBankTransactionResponse extends ToolResponse {
  output: {
    transaction: {
      id: string
      bank_account: string
      date: string
      amount: number
      payee: string | null
      description: string | null
      status: string
      matched: boolean
    }
    reconciliation_info: {
      matched_invoice_id?: string
      matched_bill_id?: string
      confidence_score: number
      reconciliation_method: string
    }
    metadata: {
      transaction_id: string
      bank_account_id: string
      amount: number
      reconciled_at: string
    }
  }
}

export interface TrackInventoryResponse extends ToolResponse {
  output: {
    item: {
      id: string
      code: string
      name: string
      quantity_on_hand: number
      quantity_change: number
      transaction_type: string
      unit_cost?: number
    }
    inventory_value: {
      previous_quantity: number
      new_quantity: number
      unit_cost: number
      total_value: number
    }
    metadata: {
      item_id: string
      item_code: string
      updated_at: string
    }
  }
}

export interface CreatePurchaseOrderResponse extends ToolResponse {
  output: {
    purchase_order: {
      id: string
      po_number: string
      supplier_name: string
      total_amount: number
      currency: string
      status: string
      created: string
      delivery_date: string | null
    }
    lines: Array<{
      description: string
      quantity: number
      unit_amount: number
      total: number
    }>
    metadata: {
      po_id: string
      po_number: string
      supplier_id: string
      total_amount: number
    }
  }
}

// ============================================================================
// Union Type for All Xero Responses
// ============================================================================

export type XeroResponse =
  | CreateInvoiceResponse
  | CreateBillResponse
  | ReconcileBankTransactionResponse
  | TrackInventoryResponse
  | CreatePurchaseOrderResponse
