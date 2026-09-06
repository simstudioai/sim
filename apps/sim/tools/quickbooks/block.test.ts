import { describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import * as quickBooksTools from '@/tools/quickbooks'
import { QUICKBOOKS_REPORTS } from '@/tools/quickbooks/report-metadata'

function requiredCondition(fieldId: string, values: Record<string, unknown>) {
  const field = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === fieldId)
  if (!field || typeof field.required !== 'function') {
    throw new Error(`${fieldId} does not define a dynamic required condition`)
  }
  return field.required(values)
}

describe('QuickBooks block conditional name requirements', () => {
  it('requires one supported customer or vendor name field', () => {
    expect(requiredCondition('displayName', { operation: 'quickbooks_create_customer' })).toEqual({
      field: 'operation',
      value: 'quickbooks_create_customer',
    })
    expect(
      requiredCondition('displayName', {
        operation: 'quickbooks_create_customer',
        givenName: 'Ada',
      })
    ).toEqual({ field: 'operation', value: [] })
    expect(
      requiredCondition('givenName', {
        operation: 'quickbooks_create_vendor',
        familyName: 'Lovelace',
      })
    ).toEqual({ field: 'operation', value: [] })
  })

  it('requires an employee given or family name even when displayName is supplied', () => {
    expect(
      requiredCondition('givenName', {
        operation: 'quickbooks_create_employee',
        displayName: 'Ada Lovelace',
      })
    ).toEqual({ field: 'operation', value: 'quickbooks_create_employee' })
    expect(
      requiredCondition('givenName', {
        operation: 'quickbooks_create_employee',
        familyName: 'Lovelace',
      })
    ).toEqual({ field: 'operation', value: [] })
  })
})

describe('QuickBooks block operation coverage', () => {
  it('keeps exports, operation options, and tool access in exact parity', () => {
    const toolIds = Object.values(quickBooksTools)
      .filter(
        (value): value is { id: string } =>
          typeof value === 'object' &&
          value !== null &&
          'id' in value &&
          typeof value.id === 'string' &&
          value.id.startsWith('quickbooks_')
      )
      .map((tool) => tool.id)
      .sort()
    const operation = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    if (!operation || !('options' in operation) || !Array.isArray(operation.options)) {
      throw new Error('QuickBooks operation dropdown is missing')
    }
    const optionIds = operation.options.map((option) => option.id).sort()
    const accessIds = [...(QuickBooksBlock.tools?.access ?? [])].sort()

    expect(toolIds).toHaveLength(49)
    expect(optionIds).toEqual(toolIds)
    expect(accessIds).toEqual(toolIds)
    for (const toolId of toolIds) {
      expect(QuickBooksBlock.tools?.config?.tool?.({ operation: toolId })).toBe(toolId)
    }
  })

  it('uses unique sub-block IDs', () => {
    const ids = QuickBooksBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

function blockParams(values: Record<string, unknown>): Record<string, unknown> {
  const params = QuickBooksBlock.tools?.config?.params
  if (!params) throw new Error('QuickBooks block does not define a params mapper')
  return params(values) as Record<string, unknown>
}

function staticRequiredValue(fieldId: string): unknown {
  const field = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === fieldId)
  if (!field || typeof field.required !== 'object') {
    throw new Error(`${fieldId} does not define a static required condition`)
  }
  return field.required.value
}

describe('QuickBooks block documented requirements', () => {
  it('requires a customer only where Intuit lists CustomerRef on the request model', () => {
    const required = staticRequiredValue('customerId') as string[]
    expect(required).toContain('quickbooks_create_invoice')
    expect(required).toContain('quickbooks_create_estimate')
    expect(required).toContain('quickbooks_create_credit_memo')
    expect(required).not.toContain('quickbooks_create_sales_receipt')
    expect(required).not.toContain('quickbooks_create_refund_receipt')
  })

  it('accepts the documented maximum page size of 1000', () => {
    expect(
      blockParams({
        operation: 'quickbooks_read_master_data',
        readMode: 'list',
        maxResults: '1000',
      }).maxResults
    ).toBe(1000)
    expect(() =>
      blockParams({
        operation: 'quickbooks_read_master_data',
        readMode: 'list',
        maxResults: '1001',
      })
    ).toThrow('maxResults must be an integer from 1 through 1000')
  })

  it('omits pagination from every by-ID read', () => {
    for (const [operation, extra] of [
      ['quickbooks_read_master_data', { recordType: 'customer' }],
      ['quickbooks_read_sales_transactions', { transactionType: 'invoice' }],
      ['quickbooks_read_purchasing_transactions', { purchasingTransactionType: 'bill' }],
      ['quickbooks_read_accounting_transactions', { accountingTransactionType: 'deposit' }],
      ['quickbooks_read_attachments', {}],
    ] as const) {
      const mapped = blockParams({
        operation,
        readMode: 'by_id',
        startPosition: '5',
        maxResults: '10',
        ...extra,
      })
      expect(mapped, operation).not.toHaveProperty('startPosition')
      expect(mapped, operation).not.toHaveProperty('maxResults')
    }
  })
})

describe('QuickBooks block wiring for documented tool parameters', () => {
  it('sends the multicurrency and tax-treatment fields on the creates that document them', () => {
    const bill = blockParams({
      operation: 'quickbooks_create_bill',
      currencyCode: 'EUR',
      globalTaxCalculation: 'TaxInclusive',
    })
    expect(bill.currencyCode).toBe('EUR')
    expect(bill.globalTaxCalculation).toBe('TaxInclusive')

    const billPayment = blockParams({
      operation: 'quickbooks_create_bill_payment',
      currencyCode: 'EUR',
      globalTaxCalculation: 'TaxInclusive',
      apAccountId: 'ap-1',
      documentNumber: 'BP-1',
    })
    expect(billPayment.currencyCode).toBe('EUR')
    expect(billPayment.globalTaxCalculation).toBeUndefined()
    expect(billPayment.apAccountId).toBe('ap-1')
    expect(billPayment.documentNumber).toBe('BP-1')

    const journalEntry = blockParams({
      operation: 'quickbooks_create_journal_entry',
      currencyCode: 'GBP',
      globalTaxCalculation: 'default',
    })
    expect(journalEntry.currencyCode).toBe('GBP')
    expect(journalEntry.globalTaxCalculation).toBeUndefined()
  })

  it('sends a purchase-order due date', () => {
    expect(
      blockParams({ operation: 'quickbooks_create_purchase_order', dueDate: '2026-09-30' }).dueDate
    ).toBe('2026-09-30')
    expect(
      blockParams({ operation: 'quickbooks_update_purchase_order', dueDate: '2026-09-30' }).dueDate
    ).toBe('2026-09-30')
  })

  it('coerces the quick-zoom switch to the boolean the report tool requires', () => {
    expect(
      blockParams({
        operation: 'quickbooks_run_financial_report',
        reportType: 'balance_sheet',
        reportQuickZoomUrl: 'true',
      }).quickZoomUrl
    ).toBe(true)
    expect(
      blockParams({
        operation: 'quickbooks_run_financial_report',
        reportType: 'cash_flow',
        reportQuickZoomUrl: 'true',
      }).quickZoomUrl
    ).toBeUndefined()
  })

  it('sends the report date macro and the employee filter', () => {
    expect(
      blockParams({
        operation: 'quickbooks_run_financial_report',
        reportType: 'balance_sheet',
        reportDateMacro: 'last_fiscal_year',
      }).dateMacro
    ).toBe('last_fiscal_year')
    expect(
      blockParams({
        operation: 'quickbooks_run_financial_report',
        reportType: 'profit_and_loss_detail',
        reportEmployeeId: 'employee-1',
      }).employeeId
    ).toBe('employee-1')
  })

  it('offers every documented report in the report dropdown', () => {
    const reportType = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === 'reportType')
    if (!reportType || !('options' in reportType) || !Array.isArray(reportType.options)) {
      throw new Error('QuickBooks report dropdown is missing')
    }
    expect(reportType.options.map((option) => option.id).sort()).toEqual(
      Object.keys(QUICKBOOKS_REPORTS).sort()
    )
  })

  it('keeps the by-ID read target and the mutation target as separate fields', () => {
    for (const [operation, extra] of [
      ['quickbooks_read_sales_transactions', { transactionType: 'invoice' }],
      ['quickbooks_read_purchasing_transactions', { purchasingTransactionType: 'bill' }],
      ['quickbooks_read_accounting_transactions', { accountingTransactionType: 'deposit' }],
    ] as const) {
      const mapped = blockParams({
        operation,
        readMode: 'by_id',
        readTransactionId: '5',
        transactionId: '99',
        ...extra,
      })
      expect(mapped.transactionId, operation).toBe('5')
    }

    expect(
      blockParams({
        operation: 'quickbooks_update_purchase_order',
        readTransactionId: '5',
        transactionId: '99',
        syncToken: '0',
      }).purchaseOrderId
    ).toBe('99')

    const readField = QuickBooksBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'readTransactionId'
    )
    const mutationField = QuickBooksBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'transactionId'
    )
    expect(readField).toBeDefined()
    const mutationOperations = (mutationField?.condition as { value: string[] }).value
    for (const readOperation of [
      'quickbooks_read_sales_transactions',
      'quickbooks_read_purchasing_transactions',
      'quickbooks_read_accounting_transactions',
    ]) {
      expect(mutationOperations, readOperation).not.toContain(readOperation)
    }
  })

  it('keeps the upload and download attachment file names as separate fields', () => {
    expect(
      blockParams({
        operation: 'quickbooks_download_attachment',
        attachmentId: 'attachment-1',
        downloadAttachmentFileName: 'saved.pdf',
      }).fileName
    ).toBe('saved.pdf')
    expect(
      blockParams({
        operation: 'quickbooks_add_attachment',
        attachmentKind: 'note',
        attachmentFileName: 'ignored.pdf',
      }).fileName
    ).toBeUndefined()

    const uploadName = QuickBooksBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'attachmentFileName'
    )
    expect(uploadName?.condition).toEqual({
      field: 'operation',
      value: 'quickbooks_add_attachment',
      and: { field: 'attachmentKind', value: 'file' },
    })
  })
})
