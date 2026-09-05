import { ZodError } from 'zod'
import { ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  getOracleFusionInvoice,
  listOracleFusionInvoices,
} from '@/lib/internal/oracle-fusion-financials/operations'
import { oracleFusionInvoiceSchema } from '@/lib/internal/oracle-fusion-financials/schema'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  listSelectorResult,
} from '@/lib/selectors/server/types'
import type { SafeOptionMeta, SafeSelectorOption } from '@/lib/selectors/types'

type OracleFusionFinancialsSelectorKey = Extract<
  ServerSelectorKey,
  'oracleFusionFinancials.invoices'
>

interface PreparedOracleFusionDestination {
  oauthCredential: string
  accessToken: string
  instanceUrl: string
}

const INVOICE_PAGE_SIZE = 50

function parseOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset)) throw new SelectorContextUnavailableError()
  return offset
}

function invoiceOption(value: unknown, expectedId?: string): SafeSelectorOption {
  const invoice = oracleFusionInvoiceSchema.parse(value)
  const id = invoice.invoiceUniqId
  if (typeof id !== 'string' || !id) throw new SelectorOptionsUnavailableError()
  if (expectedId !== undefined && id !== expectedId) throw new SelectorOptionsUnavailableError()

  const number = typeof invoice.InvoiceNumber === 'string' ? invoice.InvoiceNumber.trim() : ''
  const supplier = typeof invoice.Supplier === 'string' ? invoice.Supplier.trim() : ''
  const label = number && supplier ? `${number} — ${supplier}` : number || supplier || id
  const meta: SafeOptionMeta = {}
  if (invoice.InvoiceAmount !== undefined) meta.amount = invoice.InvoiceAmount
  if (invoice.InvoiceCurrency !== undefined) meta.currency = invoice.InvoiceCurrency
  if (invoice.InvoiceDate !== undefined) meta.date = invoice.InvoiceDate
  if (invoice.PaidStatus !== undefined) meta.status = invoice.PaidStatus
  return { id, label, ...(Object.keys(meta).length ? { meta } : {}) }
}

async function prepareOracleFusionDestination(
  args: ExecuteServerSelectorArgs
): Promise<PreparedOracleFusionDestination> {
  if (
    !args.credential?.access?.resolvedCredentialId ||
    args.credential.providerId !== ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
    recordCredentialUse: args.recordCredentialUse,
    providerId: ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
  })
  if (!bundle.accessToken || !bundle.instanceUrl) throw new SelectorConnectionUnavailableError()
  return {
    oauthCredential: args.credential.access.resolvedCredentialId,
    accessToken: bundle.accessToken,
    instanceUrl: bundle.instanceUrl,
  }
}

function mapProviderError(error: unknown): never {
  if (error instanceof OracleFusionProviderError) {
    throw selectorProviderStatusError(error.status)
  }
  if (error instanceof SelectorContextUnavailableError) throw error
  if (error instanceof SelectorConnectionUnavailableError) throw error
  if (error instanceof SelectorOptionsUnavailableError) throw error
  throw new SelectorOptionsUnavailableError()
}

async function listInvoices(
  args: ExecuteServerSelectorArgs,
  auth: PreparedOracleFusionDestination
) {
  if (args.request.kind !== 'list') throw new SelectorContextUnavailableError()
  if (args.request.search?.trim()) throw new SelectorContextUnavailableError()
  const offset = parseOffset(args.request.cursor)
  try {
    const { output: payload } = await listOracleFusionInvoices(
      { ...auth, orderBy: 'InvoiceDate:desc', limit: INVOICE_PAGE_SIZE, offset },
      args.signal
    )
    return listSelectorResult(
      payload.items.map((item) => invoiceOption(item)),
      payload.hasMore ? String(payload.offset + payload.count) : undefined
    )
  } catch (error) {
    if (args.signal?.aborted) throw error
    mapProviderError(error)
  }
}

async function getInvoice(args: ExecuteServerSelectorArgs, auth: PreparedOracleFusionDestination) {
  if (args.request.kind !== 'detail') throw new SelectorContextUnavailableError()
  const id = args.request.id
  try {
    const { output } = await getOracleFusionInvoice({ ...auth, invoiceUniqId: id }, args.signal)
    return detailSelectorResult(invoiceOption(output.invoice, id))
  } catch (error) {
    if (args.signal?.aborted) throw error
    if (error instanceof ZodError) throw new SelectorContextUnavailableError()
    if (error instanceof OracleFusionProviderError && error.status === 404) {
      return detailSelectorResult(null)
    }
    mapProviderError(error)
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle_fusion_financials'],
} as const

export const oracleFusionFinancialsSelectorAttachments = {
  'oracleFusionFinancials.invoices': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes: ['oracle_fusion_financials'],
    destination: { kind: 'credential-bound', prepare: prepareOracleFusionDestination },
    execute: (args, auth) =>
      args.request.kind === 'detail' ? getInvoice(args, auth) : listInvoices(args, auth),
  }),
} satisfies ServerSelectorAttachmentMap<OracleFusionFinancialsSelectorKey>
