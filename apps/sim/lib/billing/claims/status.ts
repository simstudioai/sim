export const BILLING_CLAIM_PAYMENT_BLOCKING_STATUSES = ['claimed', 'invoiced', 'failed'] as const

export const BILLING_CLAIM_COVERED_OVERAGE_STATUSES = [
  'claimed',
  'invoiced',
  'paid',
  'failed',
] as const

export const BILLING_CLAIM_INVOICE_WRITEABLE_STATUSES = ['claimed'] as const

export const BILLING_CLAIM_WEBHOOK_MUTABLE_STATUSES = ['claimed', 'invoiced', 'failed'] as const
