/**
 * FreshBooks API Types
 * Using @freshbooks/api SDK for type-safe FreshBooks integrations
 */

import type { ToolResponse } from '@/tools/types'

// ============================================================================
// Shared Types
// ============================================================================

export interface FreshBooksClient {
  id: number
  organization: string
  fname: string
  lname: string
  email: string
  phone?: string
  company_name?: string
  vat_number?: string
  currency_code: string
}

export interface FreshBooksInvoice {
  id: number
  invoiceid: number
  invoice_number: string
  customerid: number
  create_date: string
  due_date: string
  status: string
  amount: {
    amount: string
    code: string
  }
  outstanding: {
    amount: string
    code: string
  }
  paid: {
    amount: string
    code: string
  }
  lines: Array<{
    name: string
    description?: string
    qty: number
    unit_cost: {
      amount: string
      code: string
    }
    amount: {
      amount: string
      code: string
    }
  }>
}

export interface FreshBooksTimeEntry {
  id: number
  identity_id: number
  timer?: {
    is_running: boolean
    started_at?: string
  }
  is_logged: boolean
  started_at: string
  duration: number
  client_id?: number
  project_id?: number
  service_id?: number
  note?: string
  billable: boolean
  billed: boolean
}

export interface FreshBooksExpense {
  id: number
  amount: {
    amount: string
    code: string
  }
  vendor: string
  date: string
  category: {
    category: string
    categoryid: number
  }
  clientid?: number
  projectid?: number
  taxName1?: string
  taxAmount1?: {
    amount: string
    code: string
  }
  notes?: string
  attachment?: {
    id: number
    jwt: string
    media_type: string
  }
}

export interface FreshBooksPayment {
  id: number
  invoiceid: number
  amount: {
    amount: string
    code: string
  }
  date: string
  type: string
  note?: string
}

export interface FreshBooksEstimate {
  id: number
  estimateid: number
  estimate_number: string
  customerid: number
  create_date: string
  status: string
  amount: {
    amount: string
    code: string
  }
  lines: Array<{
    name: string
    description?: string
    qty: number
    unit_cost: {
      amount: string
      code: string
    }
    amount: {
      amount: string
      code: string
    }
  }>
}

// ============================================================================
// Tool Parameter Types
// ============================================================================

export interface CreateClientParams {
  apiKey: string
  accountId: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  companyName?: string
  currencyCode?: string
  notes?: string
}

export interface CreateInvoiceParams {
  apiKey: string
  accountId: string
  clientId: number
  dueDate?: string
  lines: Array<{
    name: string
    description?: string
    quantity: number
    unitCost: number
  }>
  notes?: string
  currencyCode?: string
  autoSend?: boolean
}

export interface TrackTimeParams {
  apiKey: string
  accountId: string
  businessId: number
  clientId?: number
  projectId?: number
  serviceId?: number
  hours: number
  note?: string
  date?: string
  billable?: boolean
  startTimer?: boolean
}

export interface CreateExpenseParams {
  apiKey: string
  accountId: string
  amount: number
  vendor: string
  date?: string
  categoryId?: number
  clientId?: number
  projectId?: number
  notes?: string
  taxName?: string
  taxPercent?: number
}

export interface RecordPaymentParams {
  apiKey: string
  accountId: string
  invoiceId: number
  amount: number
  date?: string
  paymentType?: string
  note?: string
}

export interface GetOutstandingInvoicesParams {
  apiKey: string
  accountId: string
  clientId?: number
  daysOverdue?: number
  minimumAmount?: number
}

export interface CreateEstimateParams {
  apiKey: string
  accountId: string
  clientId: number
  lines: Array<{
    name: string
    description?: string
    quantity: number
    unitCost: number
  }>
  notes?: string
  currencyCode?: string
}

// ============================================================================
// Tool Response Types
// ============================================================================

export interface CreateClientResponse extends ToolResponse {
  output: {
    client: {
      id: number
      organization: string
      fname: string
      lname: string
      email: string
      company_name?: string
      currency_code: string
    }
    metadata: {
      client_id: number
      email: string
      created_at: string
    }
  }
}

export interface CreateInvoiceResponse extends ToolResponse {
  output: {
    invoice: {
      id: number
      invoice_number: string
      client_id: number
      amount_due: number
      currency: string
      status: string
      created: string
      due_date: string
      invoice_url?: string
    }
    lines: Array<{
      name: string
      quantity: number
      unit_cost: number
      total: number
    }>
    metadata: {
      invoice_id: number
      invoice_number: string
      total_amount: number
      status: string
    }
  }
}

export interface TrackTimeResponse extends ToolResponse {
  output: {
    time_entry: {
      id: number
      client_id?: number
      project_id?: number
      hours: number
      billable: boolean
      billed: boolean
      date: string
      note?: string
      timer_running: boolean
    }
    metadata: {
      time_entry_id: number
      duration_hours: number
      billable: boolean
      created_at: string
    }
  }
}

export interface CreateExpenseResponse extends ToolResponse {
  output: {
    expense: {
      id: number
      amount: number
      currency: string
      vendor: string
      date: string
      category: string
      client_id?: number
      project_id?: number
      notes?: string
    }
    metadata: {
      expense_id: number
      amount: number
      vendor: string
      created_at: string
    }
  }
}

export interface RecordPaymentResponse extends ToolResponse {
  output: {
    payment: {
      id: number
      invoice_id: number
      amount: number
      currency: string
      date: string
      type: string
      note?: string
    }
    invoice_status: {
      id: number
      total_amount: number
      paid_amount: number
      outstanding_amount: number
      status: string
    }
    metadata: {
      payment_id: number
      invoice_id: number
      amount_paid: number
      payment_date: string
    }
  }
}

export interface GetOutstandingInvoicesResponse extends ToolResponse {
  output: {
    outstanding_invoices: Array<{
      id: number
      invoice_number: string
      client_name: string
      amount_due: number
      currency: string
      due_date: string
      days_overdue: number
      status: string
    }>
    summary: {
      total_outstanding: number
      total_invoices: number
      average_days_overdue: number
      total_clients_affected: number
    }
    aging_analysis: {
      current: number
      overdue_1_30_days: number
      overdue_31_60_days: number
      overdue_61_90_days: number
      overdue_over_90_days: number
    }
    metadata: {
      total_outstanding: number
      invoice_count: number
      generated_at: string
    }
  }
}

export interface CreateEstimateResponse extends ToolResponse {
  output: {
    estimate: {
      id: number
      estimate_number: string
      client_id: number
      amount: number
      currency: string
      status: string
      created: string
    }
    lines: Array<{
      name: string
      quantity: number
      unit_cost: number
      total: number
    }>
    metadata: {
      estimate_id: number
      estimate_number: string
      total_amount: number
      status: string
    }
  }
}

// ============================================================================
// Union Type for All FreshBooks Responses
// ============================================================================

export type FreshBooksResponse =
  | CreateClientResponse
  | CreateInvoiceResponse
  | TrackTimeResponse
  | CreateExpenseResponse
  | RecordPaymentResponse
  | GetOutstandingInvoicesResponse
  | CreateEstimateResponse
