import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { InvoiceItem } from '@/lib/api/contracts/subscription'
import { lagoRequest } from '@/lib/billing/lago/client'
import { toLagoCustomerExternalId } from '@/lib/billing/lago/external-ids'
import type { LagoBillingEntityType, LagoInvoicesResponse } from '@/lib/billing/lago/types'

const logger = createLogger('LagoInvoices')

/**
 * Lists recent Lago invoices for a billing entity, mapped to the Sim invoice wire shape.
 */
export async function listLagoInvoices(
  entityType: LagoBillingEntityType,
  entityId: string,
  limit = 12
): Promise<{ invoices: InvoiceItem[]; hasMore: boolean }> {
  const externalId = toLagoCustomerExternalId(entityType, entityId)

  try {
    const response = await lagoRequest<LagoInvoicesResponse>(
      'GET',
      `/invoices?external_customer_id=${encodeURIComponent(externalId)}&per_page=${limit}&page=1`
    )

    const invoices: InvoiceItem[] = (response.invoices ?? []).map((invoice) => ({
      id: invoice.lago_id,
      number: invoice.number,
      created: Math.floor(new Date(invoice.issuing_date).getTime() / 1000),
      total: invoice.total_amount_cents,
      amountPaid: invoice.payment_status === 'succeeded' ? invoice.total_amount_cents : 0,
      currency: invoice.currency,
      status: invoice.payment_status || invoice.status,
      hostedInvoiceUrl: invoice.file_url,
      invoicePdf: invoice.file_url,
    }))

    const hasMore = Boolean(response.meta?.next_page && response.meta.next_page > 1)
    return { invoices, hasMore }
  } catch (error) {
    logger.error('Failed to list Lago invoices', {
      externalId,
      error: getErrorMessage(error),
    })
    return { invoices: [], hasMore: false }
  }
}
