/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  oracleFusionAppliedPrepaymentSchema,
  oracleFusionApplyReceivablesReceiptInputSchema,
  oracleFusionAvailablePrepaymentSchema,
  oracleFusionCreateExpenseLineInputSchema,
  oracleFusionCreateExpenseReportInputSchema,
  oracleFusionCreateReceivablesCreditMemoInputSchema,
  oracleFusionCreateReceivablesInvoiceInputSchema,
  oracleFusionCreateReceivablesReceiptInputSchema,
  oracleFusionExpenseLineSchema,
  oracleFusionGetExpenseReportInputSchema,
  oracleFusionGetGlJournalLineInputSchema,
  oracleFusionGetInvoiceInputSchema,
  oracleFusionGlBalanceSchema,
  oracleFusionGlJournalLineSchema,
  oracleFusionGlLedgerSchema,
  oracleFusionInstallmentSchema,
  oracleFusionInvoiceDistributionSchema,
  oracleFusionInvoiceHoldSchema,
  oracleFusionInvoiceLineSchema,
  oracleFusionInvoiceSchema,
  oracleFusionListInvoicesInputSchema,
  oracleFusionPaymentProcessRequestSchema,
  oracleFusionPaymentRelatedInvoiceSchema,
  oracleFusionPaymentSchema,
  oracleFusionPaymentTermLineSchema,
  oracleFusionPaymentTermSchema,
  oracleFusionReceivablesCreditMemoSchema,
  oracleFusionReceivablesInvoiceSchema,
  oracleFusionUpdateExpenseDistributionInputSchema,
  oracleFusionUpdateReceivablesInvoiceInputSchema,
  oracleFusionUpdateReceivablesInvoiceInstallmentInputSchema,
  projectFields,
} from '@/lib/internal/oracle-fusion-financials/schema'

const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'server-resolved-credential',
  instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
}

describe('Oracle Fusion Financials product schemas', () => {
  it('preserves balance markers, nullable ledger IDs, and exact journal line numbers', () => {
    expect(
      oracleFusionGlBalanceSchema.parse({
        ActualBalance: '#MISSING',
        BeginningBalance: null,
        EndingBalance: 'N/A',
        PeriodActivity: '120.00',
      })
    ).toEqual({
      ActualBalance: '#MISSING',
      BeginningBalance: null,
      EndingBalance: 'N/A',
      PeriodActivity: '120.00',
    })
    expect(oracleFusionGlBalanceSchema.safeParse({ ActualBalance: 120 }).success).toBe(false)
    expect(oracleFusionGlLedgerSchema.parse({ LedgerId: null })).toEqual({ LedgerId: null })
    expect(oracleFusionGlJournalLineSchema.parse({ JeLineNumber: '9007199254740993' })).toEqual({
      JeLineNumber: '9007199254740993',
    })
    const keys = {
      ...AUTH,
      glJournalBatchId: '42',
      glJournalHeaderUniqId: ' header%2Fkey ',
      glJournalLineUniqId: ' line key ',
    }
    expect(oracleFusionGetGlJournalLineInputSchema.parse(keys)).toMatchObject(keys)
  })

  it('requires explicit expense creation identities without inventing tenant defaults', () => {
    expect(oracleFusionCreateExpenseReportInputSchema.safeParse(AUTH).success).toBe(false)
    const line = {
      ...AUTH,
      expenseReportUniqId: 'REPORTKEY',
      assignmentId: '1',
      orgId: '2',
      personId: '3',
      ticketClass: 'Economy',
    }
    expect(oracleFusionCreateExpenseLineInputSchema.safeParse(line).success).toBe(true)
    for (const key of ['assignmentId', 'orgId', 'personId', 'ticketClass']) {
      expect(
        oracleFusionCreateExpenseLineInputSchema.safeParse({
          ...line,
          [key]: undefined,
        }).success
      ).toBe(false)
    }
    const distribution = {
      ...AUTH,
      expenseReportUniqId: 'REPORTKEY',
      expenseLineUniqId: 'LINEKEY',
      expenseDistributionId: '4',
      expenseId: '5',
      orgId: '2',
      costCenter: '120',
    }
    expect(oracleFusionUpdateExpenseDistributionInputSchema.safeParse(distribution).success).toBe(
      true
    )
    for (const key of ['expenseId', 'orgId']) {
      expect(
        oracleFusionUpdateExpenseDistributionInputSchema.safeParse({
          ...distribution,
          [key]: undefined,
        }).success
      ).toBe(false)
    }
  })

  it('preserves opaque expense keys and the documented itemization-parent sentinel', () => {
    const expenseReportUniqId = ' report%2Fkey '
    expect(
      oracleFusionGetExpenseReportInputSchema.parse({
        ...AUTH,
        expenseReportUniqId,
      }).expenseReportUniqId
    ).toBe(expenseReportUniqId)
    expect(
      oracleFusionExpenseLineSchema.parse({
        ExpenseId: '9007199254740993',
        ItemizationParentExpenseId: -1,
        ReceiptAmount: null,
        ExpenseReference: 12,
      })
    ).toEqual({
      ExpenseId: '9007199254740993',
      ItemizationParentExpenseId: '-1',
      ReceiptAmount: null,
      ExpenseReference: 12,
    })
    expect(
      oracleFusionExpenseLineSchema.safeParse({
        ExpenseReference: '12',
      }).success
    ).toBe(false)
  })

  it('retains Receivables exact identities, nullable balances, and string freight amounts', () => {
    expect(
      oracleFusionReceivablesInvoiceSchema.parse({
        CustomerTransactionId: '9.007199254740993e15',
        InvoiceBalanceAmount: null,
      })
    ).toEqual({ CustomerTransactionId: '9007199254740993', InvoiceBalanceAmount: null })
    expect(
      oracleFusionReceivablesCreditMemoSchema.parse({
        FreightCreditAmount: '12.50',
        CreditReason: null,
      })
    ).toEqual({ FreightCreditAmount: '12.50', CreditReason: null })
    expect(
      oracleFusionReceivablesCreditMemoSchema.safeParse({
        FreightCreditAmount: 12.5,
      }).success
    ).toBe(false)
  })

  it('requires documented credit-memo and receipt creation attributes', () => {
    const creditMemo = {
      ...AUTH,
      businessUnit: 'Example BU',
      transactionNumber: 'CM-1',
      transactionDate: '2026-09-01',
    }
    const receipt = {
      ...AUTH,
      amount: 10,
      businessUnit: 'Example BU',
      currency: 'USD',
      receiptDate: '2026-09-01',
      receiptMethod: 'Manual',
    }
    expect(oracleFusionCreateReceivablesCreditMemoInputSchema.safeParse(creditMemo).success).toBe(
      true
    )
    expect(oracleFusionCreateReceivablesReceiptInputSchema.safeParse(receipt).success).toBe(true)
    for (const key of ['businessUnit', 'transactionNumber', 'transactionDate']) {
      expect(
        oracleFusionCreateReceivablesCreditMemoInputSchema.safeParse({
          ...creditMemo,
          [key]: undefined,
        }).success
      ).toBe(false)
    }
    for (const key of ['amount', 'businessUnit', 'currency', 'receiptDate', 'receiptMethod']) {
      expect(
        oracleFusionCreateReceivablesReceiptInputSchema.safeParse({
          ...receipt,
          [key]: undefined,
        }).success
      ).toBe(false)
    }
  })

  it('rejects unsupported nested fields and empty restricted updates', () => {
    expect(
      oracleFusionCreateReceivablesInvoiceInputSchema.safeParse({
        ...AUTH,
        lines: [{ arbitraryField: 'not allowed' }],
      }).success
    ).toBe(false)
    expect(
      oracleFusionCreateReceivablesInvoiceInputSchema.safeParse({
        ...AUTH,
        invoiceStatus: 'Incomplete',
      }).success
    ).toBe(false)
    expect(
      oracleFusionUpdateReceivablesInvoiceInputSchema.safeParse({
        ...AUTH,
        receivablesInvoiceId: '42',
        businessUnit: 'Cannot update this',
      }).success
    ).toBe(false)
    expect(
      oracleFusionUpdateReceivablesInvoiceInstallmentInputSchema.safeParse({
        ...AUTH,
        receivablesInvoiceId: '42',
        receivablesInvoiceInstallmentId: '7',
        excludeFromCollections: true,
      }).success
    ).toBe(false)
  })

  it.each(['9007199254740993\n', '1.5', '-1', '1e2', '001', '1/child', 9007199254740992])(
    'rejects ambiguous receipt application identifiers %j before serialization',
    (appliedPaymentScheduleId) => {
      expect(
        oracleFusionApplyReceivablesReceiptInputSchema.safeParse({
          ...AUTH,
          receivablesReceiptId: '42',
          appliedPaymentScheduleId,
        }).success
      ).toBe(false)
    }
  )

  it.each([
    [
      oracleFusionInvoiceSchema,
      { InvoiceId: '9007199254740993', Supplier: null, AmountPaid: null },
    ],
    [oracleFusionInvoiceLineSchema, { LineNumber: '1', LineAmount: null, DiscardedFlag: false }],
    [
      oracleFusionInstallmentSchema,
      { InstallmentNumber: '1', UnpaidAmount: null, HoldReason: null },
    ],
    [
      oracleFusionInvoiceDistributionSchema,
      { InvoiceDistributionId: '99', TaxRate: '20', PrepaymentLineNumber: '1', BaseAmount: null },
    ],
    [
      oracleFusionAppliedPrepaymentSchema,
      { LineNumber: null, AppliedAmount: 40.5, IncludedTax: null },
    ],
    [oracleFusionAvailablePrepaymentSchema, { LineNumber: '1', AvailableAmount: null }],
    [oracleFusionPaymentSchema, { CheckId: '42', PaymentId: null, ReconciledFlag: null }],
    [
      oracleFusionPaymentRelatedInvoiceSchema,
      { InvoicePaymentId: '88', InvoiceAmount: null, AmountPaidPaymentCurrency: 12.5 },
    ],
    [oracleFusionInvoiceHoldSchema, { HoldId: '21', ReleaseDate: null, HoldReason: null }],
    [
      oracleFusionPaymentProcessRequestSchema,
      { PaymentProcessRequestId: '17', PaymentProcessRequestStatusMeaning: null },
    ],
    [oracleFusionPaymentTermSchema, { termsId: '73', enabledFlag: false, toDate: null }],
    [oracleFusionPaymentTermLineSchema, { termsId: '73', sequenceNumber: 1, fixedDate: null }],
  ] as const)('preserves documented nullable and typed Payables values %#', (schema, value) => {
    expect(schema.parse(value)).toEqual(value)
  })

  it.each([
    [oracleFusionInvoiceSchema, { InvoiceAmount: null }],
    [oracleFusionInvoiceLineSchema, { LineNumber: null }],
    [oracleFusionInstallmentSchema, { DueDate: null }],
    [oracleFusionInvoiceDistributionSchema, { TaxRate: 20 }],
    [oracleFusionAvailablePrepaymentSchema, { LineNumber: null }],
    [oracleFusionPaymentSchema, { ReconciledFlag: 'Y' }],
    [oracleFusionPaymentRelatedInvoiceSchema, { AmountPaidPaymentCurrency: null }],
    [oracleFusionPaymentTermSchema, { enabledFlag: 'Y' }],
    [oracleFusionPaymentTermLineSchema, { sequenceNumber: 1.5 }],
  ] as const)(
    'rejects malformed projected fields instead of guessing coercions %#',
    (schema, value) => {
      expect(schema.safeParse(value).success).toBe(false)
    }
  )

  it.each([
    [42, '42'],
    ['9007199254740993', '9007199254740993'],
    ['9007199254740993.0', '9007199254740993'],
    ['9.007199254740993e15', '9007199254740993'],
  ] as const)('normalizes documented identifier representation %j exactly', (input, expected) => {
    expect(
      oracleFusionPaymentSchema.parse({
        CheckId: input,
        PaymentId: input,
        PaymentNumber: input,
        PaymentReference: input,
      })
    ).toEqual({
      CheckId: expected,
      PaymentId: expected,
      PaymentNumber: expected,
      PaymentReference: expected,
    })
  })

  it.each([9007199254740992, 1.5, '1.5', '-1', 'Infinity', '1e999999', {}, true])(
    'rejects inexact or invalid identifiers %j',
    (value) => {
      expect(oracleFusionInvoiceSchema.safeParse({ InvoiceId: value }).success).toBe(false)
    }
  )

  it('retains v9 context until protocol validation but excludes it from public fields', () => {
    const value = {
      InvoiceId: 42,
      Description: null,
      '@context': { links: [{ rel: 'self', href: 'https://example.com/invoices/opaque' }] },
      attachments: [{ private: 'not in projection' }],
    }
    const parsed = oracleFusionInvoiceSchema.parse(value)
    expect(parsed['@context']).toEqual(value['@context'])
    expect(projectFields(parsed, ['InvoiceId', 'Description', 'Supplier'])).toEqual({
      InvoiceId: '42',
      Description: null,
    })
  })

  it.each([
    [oracleFusionInvoiceLineSchema, 'LineNumber'],
    [oracleFusionInvoiceLineSchema, 'ReceiptLineNumber'],
    [oracleFusionInstallmentSchema, 'InstallmentNumber'],
    [oracleFusionInvoiceDistributionSchema, 'ReceiptLineNumber'],
    [oracleFusionAvailablePrepaymentSchema, 'LineNumber'],
    [oracleFusionPaymentRelatedInvoiceSchema, 'InstallmentNumber'],
    [oracleFusionInvoiceHoldSchema, 'ReceiptLineNumber'],
    [oracleFusionPaymentTermSchema, 'rank'],
  ] as const)('preserves exact precision-18 field values %#', (schema, field) => {
    for (const [input, expected] of [
      [1, '1'],
      [-1, '-1'],
      ['9007199254740993', '9007199254740993'],
      ['-999999999999999999', '-999999999999999999'],
      ['-9.007199254740993e15', '-9007199254740993'],
      ['-0', '0'],
    ] as const) {
      expect(schema.parse({ [field]: input })).toEqual({ [field]: expected })
    }
    for (const input of [9007199254740992, -9007199254740992, '1.5', '1e18', {}, true]) {
      expect(schema.safeParse({ [field]: input }).success).toBe(false)
    }
  })

  it('keeps ordinary amounts and lower-precision integers numeric', () => {
    expect(
      oracleFusionAppliedPrepaymentSchema.parse({ LineNumber: 1, AppliedAmount: 12.5 })
    ).toEqual({ LineNumber: 1, AppliedAmount: 12.5 })
    expect(oracleFusionInstallmentSchema.parse({ PaymentPriority: 2, GrossAmount: 12.5 })).toEqual({
      PaymentPriority: 2,
      GrossAmount: 12.5,
    })
    expect(oracleFusionPaymentTermLineSchema.parse({ sequenceNumber: 1, days: 30 })).toEqual({
      sequenceNumber: 1,
      days: 30,
    })
    expect(oracleFusionInvoiceLineSchema.parse({ ReceiptLineNumber: null })).toEqual({
      ReceiptLineNumber: null,
    })
    expect(oracleFusionPaymentTermSchema.parse({ rank: null })).toEqual({ rank: null })
  })

  it.each([' key ', 'ELEC%2FCOMPUTER', 'invoice:123,installment=2'])(
    'preserves opaque key %j without trimming or decoding',
    (invoiceUniqId) => {
      expect(
        oracleFusionGetInvoiceInputSchema.parse({ ...AUTH, invoiceUniqId }).invoiceUniqId
      ).toBe(invoiceUniqId)
    }
  )

  it.each(['', ' ', '.', '..', 'a/b', 'a?b', 'a#b', '\uD800'])(
    'rejects an invalid opaque invoice key %j',
    (invoiceUniqId) => {
      expect(oracleFusionGetInvoiceInputSchema.safeParse({ ...AUTH, invoiceUniqId }).success).toBe(
        false
      )
    }
  )

  it('defaults to one bounded page and preserves Oracle query expressions', () => {
    const q = "InvoiceNumber like '%\\_%'"
    expect(oracleFusionListInvoicesInputSchema.parse({ ...AUTH, q })).toMatchObject({
      q,
      limit: 50,
      offset: 0,
      totalResults: false,
    })
  })

  it.each([
    { limit: 101 },
    { limit: 0 },
    { limit: '50' },
    { offset: -1 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { q: ' ' },
    { q: 'x'.repeat(8_001) },
    { finder: 'PrimaryKey\nInjected' },
    { orderBy: 'InvoiceDate\u0000' },
    { totalResults: 'true' },
    { effectiveDate: '2026-02-30' },
  ])('rejects invalid query and page controls %#', (input) => {
    expect(oracleFusionListInvoicesInputSchema.safeParse({ ...AUTH, ...input }).success).toBe(false)
  })
})
