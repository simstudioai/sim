type InvoiceStatusBadge = {
  variant: 'green' | 'amber' | 'red' | 'gray'
  label: string
}

const INVOICE_STATUS_BADGES: Record<string, InvoiceStatusBadge> = {
  paid: { variant: 'green', label: 'Paid' },
  open: { variant: 'amber', label: 'Open' },
  uncollectible: { variant: 'red', label: 'Uncollectible' },
  void: { variant: 'gray', label: 'Void' },
}

/** Resolve a Stripe invoice status to its badge presentation. */
export function getInvoiceStatusBadge(status: string | null): InvoiceStatusBadge {
  return (
    INVOICE_STATUS_BADGES[status ?? ''] ?? {
      variant: 'gray',
      label: status ?? 'Unknown',
    }
  )
}

/** Cached currency formatters, keyed by upper-cased ISO currency code. */
const invoiceAmountFormatters = new Map<string, Intl.NumberFormat>()

/** Resolve (and memoize) an `Intl.NumberFormat` for a currency code. */
function getInvoiceAmountFormatter(currency: string): Intl.NumberFormat {
  const code = currency.toUpperCase()
  let formatter = invoiceAmountFormatters.get(code)
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
    })
    invoiceAmountFormatters.set(code, formatter)
  }
  return formatter
}

/** Format a minor-unit (e.g. cents) amount as a localized currency string. */
export function formatInvoiceAmount(amountMinor: number, currency: string): string {
  return getInvoiceAmountFormatter(currency).format(amountMinor / 100)
}
