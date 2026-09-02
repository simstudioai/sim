import { ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  OracleFusionFinancialsProviderError,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion-financials/client'
import {
  extractInvoiceUniqId,
  ORACLE_FUSION_FINANCIALS_RESOURCE_PATH,
  ORACLE_FUSION_INVOICE_FIELDS,
  oracleFusionInvoiceSchema,
  oracleFusionListEnvelopeSchema,
} from '@/lib/internal/oracle-fusion-financials/schema'
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

function optionalMetaValue(value: unknown): string | number | boolean | null | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : value === null
      ? null
      : undefined
}

function invoiceOption(
  value: unknown,
  instanceUrl: string,
  expectedId?: string
): SafeSelectorOption {
  const invoice = oracleFusionInvoiceSchema.parse(value)
  const id = extractInvoiceUniqId(invoice, instanceUrl)
  if (expectedId !== undefined && id !== expectedId) throw new SelectorOptionsUnavailableError()

  const number = typeof invoice.InvoiceNumber === 'string' ? invoice.InvoiceNumber.trim() : ''
  const supplier = typeof invoice.Supplier === 'string' ? invoice.Supplier.trim() : ''
  const label = number && supplier ? `${number} — ${supplier}` : number || supplier || id
  const candidates = {
    amount: optionalMetaValue(invoice.InvoiceAmount),
    currency: optionalMetaValue(invoice.InvoiceCurrency),
    date: optionalMetaValue(invoice.InvoiceDate),
    status: optionalMetaValue(invoice.PaidStatus),
  }
  const meta = Object.fromEntries(
    Object.entries(candidates).filter((entry): entry is [string, SafeOptionMeta[string]] => {
      return entry[1] !== undefined
    })
  )
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
  return { accessToken: bundle.accessToken, instanceUrl: bundle.instanceUrl }
}

function mapProviderError(error: unknown): never {
  if (error instanceof OracleFusionFinancialsProviderError) {
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
    const payload = oracleFusionListEnvelopeSchema.parse(
      await requestOracleFusionJson(
        auth,
        {
          path: `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/invoices`,
          query: {
            fields: ORACLE_FUSION_INVOICE_FIELDS.join(','),
            links: 'self',
            orderBy: 'InvoiceDate:desc',
            limit: INVOICE_PAGE_SIZE,
            offset,
          },
        },
        args.signal
      )
    )
    if (
      payload.limit !== INVOICE_PAGE_SIZE ||
      payload.offset !== offset ||
      payload.count !== payload.items.length ||
      payload.items.length > INVOICE_PAGE_SIZE
    ) {
      throw new SelectorOptionsUnavailableError()
    }
    const nextOffset = offset + payload.count
    if (!Number.isSafeInteger(nextOffset) || (payload.hasMore && payload.count === 0)) {
      throw new SelectorOptionsUnavailableError()
    }
    return listSelectorResult(
      payload.items.map((item) => invoiceOption(item, auth.instanceUrl)),
      payload.hasMore ? String(nextOffset) : undefined
    )
  } catch (error) {
    if (args.signal?.aborted) throw error
    mapProviderError(error)
  }
}

async function getInvoice(args: ExecuteServerSelectorArgs, auth: PreparedOracleFusionDestination) {
  if (args.request.kind !== 'detail') throw new SelectorContextUnavailableError()
  const id = args.request.id.trim()
  if (
    !id ||
    id === '.' ||
    id === '..' ||
    id.length > 2_048 ||
    /[\\/?#\u0000-\u001f\u007f]/.test(id)
  ) {
    throw new SelectorContextUnavailableError()
  }
  try {
    const payload = await requestOracleFusionJson(
      auth,
      {
        path: `${ORACLE_FUSION_FINANCIALS_RESOURCE_PATH}/invoices/${encodeURIComponent(id)}`,
        query: { fields: ORACLE_FUSION_INVOICE_FIELDS.join(','), links: 'self' },
      },
      args.signal
    )
    return detailSelectorResult(invoiceOption(payload, auth.instanceUrl, id))
  } catch (error) {
    if (args.signal?.aborted) throw error
    if (error instanceof OracleFusionFinancialsProviderError && error.status === 404) {
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
