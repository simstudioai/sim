import { createLogger } from '@sim/logger'
import type Stripe from 'stripe'
import { apportionCredits, dollarsToCredits } from '@/lib/billing/credits/conversion'

const logger = createLogger('InvoiceCreditSummary')

/** Provider-defined limit for Stripe invoice custom fields. */
const STRIPE_INVOICE_CUSTOM_FIELD_LIMIT = 4

const INVOICE_CREDIT_FIELD_NAMES = {
  periodUsage: 'Credits used',
  usageCharge: 'Credit usage',
  creditPurchase: 'Credits purchased',
} as const

interface InvoiceCustomField {
  name: string
  value: string
}

export interface PeriodUsageCreditSummary {
  type: 'period_usage'
  creditsUsed: number
}

export interface UsageChargeCreditSummary {
  type: 'usage_charge'
  creditsUsed: number
  prepaidCreditsApplied: number
  creditsBilled: number
}

export interface CreditPurchaseSummary {
  type: 'credit_purchase'
  creditsPurchased: number
}

export type InvoiceCreditSummary =
  | PeriodUsageCreditSummary
  | UsageChargeCreditSummary
  | CreditPurchaseSummary

function requireNonNegativeDollars(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative dollar amount`)
  }
  return value
}

function formatCredits(credits: number): string {
  return credits.toLocaleString('en-US')
}

function creditSummaryField(summary: InvoiceCreditSummary): InvoiceCustomField {
  switch (summary.type) {
    case 'period_usage':
      return {
        name: INVOICE_CREDIT_FIELD_NAMES.periodUsage,
        value: formatCredits(summary.creditsUsed),
      }
    case 'usage_charge':
      return {
        name: INVOICE_CREDIT_FIELD_NAMES.usageCharge,
        value: `${formatCredits(summary.creditsUsed)} used; ${formatCredits(summary.prepaidCreditsApplied)} prepaid; ${formatCredits(summary.creditsBilled)} billed`,
      }
    case 'credit_purchase':
      return {
        name: INVOICE_CREDIT_FIELD_NAMES.creditPurchase,
        value: formatCredits(summary.creditsPurchased),
      }
  }
}

function isCreditSummaryField(field: InvoiceCustomField): boolean {
  return Object.values(INVOICE_CREDIT_FIELD_NAMES).some((name) => name === field.name)
}

export function periodUsageCreditSummary(usageDollars: number): PeriodUsageCreditSummary {
  return {
    type: 'period_usage',
    creditsUsed: dollarsToCredits(requireNonNegativeDollars(usageDollars, 'usageDollars')),
  }
}

export function usageChargeCreditSummary(params: {
  prepaidCreditsAppliedDollars: number
  billedDollars: number
}): UsageChargeCreditSummary {
  const prepaidCreditsAppliedDollars = requireNonNegativeDollars(
    params.prepaidCreditsAppliedDollars,
    'prepaidCreditsAppliedDollars'
  )
  const billedDollars = requireNonNegativeDollars(params.billedDollars, 'billedDollars')
  const apportioned = apportionCredits([
    { key: 'prepaidCreditsApplied', dollars: prepaidCreditsAppliedDollars },
    { key: 'billed', dollars: billedDollars },
  ])

  return {
    type: 'usage_charge',
    creditsUsed: apportioned.prepaidCreditsApplied + apportioned.billed,
    prepaidCreditsApplied: apportioned.prepaidCreditsApplied,
    creditsBilled: apportioned.billed,
  }
}

export function creditPurchaseSummary(amountDollars: number): CreditPurchaseSummary {
  return {
    type: 'credit_purchase',
    creditsPurchased: dollarsToCredits(requireNonNegativeDollars(amountDollars, 'amountDollars')),
  }
}

function creditSummaryIdentity(summary: InvoiceCreditSummary): string {
  switch (summary.type) {
    case 'period_usage':
      return `${summary.type}:${summary.creditsUsed}`
    case 'usage_charge':
      return `${summary.type}:${summary.creditsUsed}:${summary.prepaidCreditsApplied}:${summary.creditsBilled}`
    case 'credit_purchase':
      return `${summary.type}:${summary.creditsPurchased}`
  }
}

export function mergeInvoiceCreditCustomFields(params: {
  summary: InvoiceCreditSummary
  existingCustomFields: Stripe.Invoice['custom_fields'] | null
}): InvoiceCustomField[] | null {
  const existingFields = (params.existingCustomFields ?? []).filter(
    (existingField) => !isCreditSummaryField(existingField)
  )

  if (existingFields.length >= STRIPE_INVOICE_CUSTOM_FIELD_LIMIT) return null

  return [...existingFields, creditSummaryField(params.summary)]
}

export type AttachInvoiceCreditSummaryResult =
  | { status: 'updated' }
  | { status: 'not_draft'; invoiceStatus: Stripe.Invoice.Status | null }
  | { status: 'custom_field_limit' }
  | { status: 'failed' }

export async function attachInvoiceCreditSummary(params: {
  stripe: Stripe
  invoice: Stripe.Invoice | string
  summary: InvoiceCreditSummary
}): Promise<AttachInvoiceCreditSummaryResult> {
  const invoiceId = typeof params.invoice === 'string' ? params.invoice : params.invoice.id
  if (!invoiceId) {
    logger.error('Cannot attach a credit summary to an invoice without an id', {
      summaryType: params.summary.type,
    })
    return { status: 'failed' }
  }

  try {
    const invoice =
      typeof params.invoice === 'string'
        ? await params.stripe.invoices.retrieve(params.invoice)
        : params.invoice
    if (invoice.status !== 'draft') {
      return { status: 'not_draft', invoiceStatus: invoice.status }
    }

    const customFields = mergeInvoiceCreditCustomFields({
      summary: params.summary,
      existingCustomFields: invoice.custom_fields,
    })
    if (!customFields) {
      logger.warn('Invoice has no available custom field slot for its credit summary', {
        invoiceId,
        summaryType: params.summary.type,
      })
      return { status: 'custom_field_limit' }
    }

    await params.stripe.invoices.update(
      invoiceId,
      { custom_fields: customFields },
      {
        idempotencyKey: `invoice-credit-summary:${invoiceId}:${creditSummaryIdentity(params.summary)}`,
      }
    )

    return { status: 'updated' }
  } catch (error) {
    logger.error('Failed to attach credit summary to invoice', {
      error,
      invoiceId,
      summaryType: params.summary.type,
    })
    return { status: 'failed' }
  }
}
