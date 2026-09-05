/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  oracleFusionAppliedPrepaymentSchema,
  oracleFusionAvailablePrepaymentSchema,
  oracleFusionGetInvoiceInputSchema,
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
  projectFields,
} from '@/lib/internal/oracle-fusion-financials/schema'

const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'server-resolved-credential',
  instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
}

describe('Oracle Fusion Financials product schemas', () => {
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
