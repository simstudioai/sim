import {
  normalizeOracleFusionApplicationOrigin,
  ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type { OracleFusionResolvedCredential } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  getProcurementSelection,
  listProcurementResource,
} from '@/lib/internal/oracle-fusion-procurement/operations'
import {
  PROCUREMENT_MAX_OFFSET,
  PROCUREMENT_PAGE_SIZE,
  procurementIdentifierSchema,
  type ProcurementResource,
} from '@/lib/internal/oracle-fusion-procurement/schema'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type ProcurementSelectorKey = Extract<ServerSelectorKey, `oracle_fusion_procurement.${string}`>

interface SelectorDefinition {
  resource: ProcurementResource
  id: string
  labels: readonly string[]
  parent?: 'supplierId' | 'poHeaderId'
}

const definitions = {
  'oracle_fusion_procurement.suppliers': {
    resource: 'suppliers',
    id: 'SupplierId',
    labels: ['Supplier', 'SupplierNumber'],
  },
  'oracle_fusion_procurement.supplierSites': {
    resource: 'supplierSites',
    id: 'SupplierSiteId',
    labels: ['SupplierSite', 'ProcurementBU'],
    parent: 'supplierId',
  },
  'oracle_fusion_procurement.purchaseRequisitions': {
    resource: 'purchaseRequisitions',
    id: 'key',
    labels: ['Requisition', 'Description'],
  },
  'oracle_fusion_procurement.draftPurchaseOrders': {
    resource: 'draftPurchaseOrders',
    id: 'key',
    labels: ['OrderNumber', 'Description'],
  },
  'oracle_fusion_procurement.purchaseOrders': {
    resource: 'purchaseOrders',
    id: 'key',
    labels: ['OrderNumber', 'Supplier'],
  },
  'oracle_fusion_procurement.purchaseOrderHeaders': {
    resource: 'purchaseOrders',
    id: 'POHeaderId',
    labels: ['OrderNumber', 'Supplier'],
  },
  'oracle_fusion_procurement.purchaseOrderReceipts': {
    resource: 'purchaseOrderReceipts',
    id: 'key',
    labels: ['Receipt', 'ItemOrScheduleDescription'],
    parent: 'poHeaderId',
  },
  'oracle_fusion_procurement.supplierNegotiations': {
    resource: 'supplierNegotiations',
    id: 'key',
    labels: ['Negotiation', 'NegotiationTitle'],
  },
  'oracle_fusion_procurement.supplierNegotiationIds': {
    resource: 'supplierNegotiations',
    id: 'AuctionHeaderId',
    labels: ['Negotiation', 'NegotiationTitle'],
  },
  'oracle_fusion_procurement.supplierNegotiationResponses': {
    resource: 'supplierNegotiationResponses',
    id: 'key',
    labels: ['ResponseNumber', 'Supplier'],
  },
  'oracle_fusion_procurement.procurementAgents': {
    resource: 'procurementAgents',
    id: 'AssignmentId',
    labels: ['Agent', 'ProcurementBU'],
  },
  'oracle_fusion_procurement.buyers': {
    resource: 'procurementAgents',
    id: 'AgentId',
    labels: ['Agent', 'ProcurementBU'],
  },
  'oracle_fusion_procurement.procurementBusinessUnits': {
    resource: 'procurementBusinessUnits',
    id: 'ProcurementBUId',
    labels: ['ProcurementBU', 'AgentAction'],
  },
  'oracle_fusion_procurement.procurementPersons': {
    resource: 'procurementPersons',
    id: 'PersonId',
    labels: ['DisplayName', 'PersonNumber'],
  },
  'oracle_fusion_procurement.purchasingDocumentStyles': {
    resource: 'purchasingDocumentStyles',
    id: 'StyleId',
    labels: ['DisplayName', 'StyleName'],
  },
  'oracle_fusion_procurement.supplierAddresses': {
    resource: 'supplierAddresses',
    id: 'SupplierAddressId',
    labels: ['AddressName', 'FormattedAddress'],
    parent: 'supplierId',
  },
} as const satisfies Record<ProcurementSelectorKey, SelectorDefinition>

async function prepareDestination(
  args: ExecuteServerSelectorArgs
): Promise<OracleFusionResolvedCredential> {
  args.signal?.throwIfAborted()
  const credential = args.credential
  const access = credential?.access
  if (!credential || access?.credentialType !== 'service_account' || !access.resolvedCredentialId) {
    throw new SelectorConnectionUnavailableError()
  }
  const account = await resolveOAuthAccountId(access.resolvedCredentialId)
  if (
    account?.credentialType !== 'service_account' ||
    account.providerId !== ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const bundle = await resolveSelectorCredentialBundle({
    credential,
    protectedValues: args.protectedValues,
  })
  if (!bundle.instanceUrl) throw new SelectorConnectionUnavailableError()
  const instanceUrl = normalizeOracleFusionApplicationOrigin(bundle.instanceUrl)
  if (!instanceUrl) throw new SelectorConnectionUnavailableError()
  return { instanceUrl, accessToken: bundle.accessToken }
}

function parentParams(args: ExecuteServerSelectorArgs, definition: SelectorDefinition) {
  if (!definition.parent) return {}
  const value =
    definition.parent === 'supplierId'
      ? args.context.oracleFusionSupplierId
      : args.context.oracleFusionPOHeaderId
  const result = procurementIdentifierSchema.safeParse(value)
  if (!result.success) throw new SelectorContextUnavailableError()
  return { [definition.parent]: result.data }
}

function parseOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(?:0|[1-9][0-9]{0,6})$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = Number(cursor) // Pagination only; Oracle business identifiers never use Number().
  if (offset > PROCUREMENT_MAX_OFFSET) throw new SelectorContextUnavailableError()
  return offset
}

function projectOption(
  item: Record<string, unknown>,
  definition: SelectorDefinition
): SafeSelectorOption | null {
  const id = item[definition.id]
  // The procurement-person schema permits an absent/null ID; it cannot become a selectable option.
  if (id === null) return null
  if (typeof id !== 'string' || !id) throw new SelectorOptionsUnavailableError()
  const labels = definition.labels
    .map((field) => item[field])
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
  return {
    id,
    label: labels[0] || id,
    ...(labels[1] && labels[1] !== labels[0] ? { meta: { detail: labels[1] } } : {}),
  }
}

async function executeProcurementSelector(
  args: ExecuteServerSelectorArgs,
  credential: OracleFusionResolvedCredential
) {
  const definition: SelectorDefinition = definitions[args.selectorKey as ProcurementSelectorKey]
  if (!definition) throw new SelectorOptionsUnavailableError()
  const params = parentParams(args, definition)
  try {
    args.signal?.throwIfAborted()
    if (args.request.kind === 'detail') {
      const item = await getProcurementSelection(
        definition.resource,
        definition.id,
        args.request.id,
        credential,
        params,
        args.signal
      )
      return detailSelectorResult(item ? projectOption(item, definition) : null)
    }
    if (args.request.search !== undefined) throw new SelectorContextUnavailableError()
    const page = await listProcurementResource(
      definition.resource,
      credential,
      {
        ...params,
        limit: PROCUREMENT_PAGE_SIZE,
        offset: parseOffset(args.request.cursor),
        totalResults: false,
      },
      args.signal
    )
    const options = new Map<string, SafeSelectorOption>()
    for (const item of page.items) {
      const option = projectOption(item, definition)
      if (option && !options.has(option.id)) options.set(option.id, option)
    }
    return listSelectorResult(
      [...options.values()],
      page.nextOffset === undefined ? undefined : String(page.nextOffset)
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      if (args.request.kind === 'detail' && error.status === 404) return detailSelectorResult(null)
      throw selectorProviderStatusError(error.status)
    }
    if (error instanceof SelectorContextUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

function attachment() {
  return definePreparedSelectorAttachment({
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['oracle_fusion_procurement'],
    },
    integrationBlockTypes: ['oracle_fusion_procurement'],
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeProcurementSelector,
  })
}

export const oracleFusionProcurementSelectorAttachments = {
  'oracle_fusion_procurement.suppliers': attachment(),
  'oracle_fusion_procurement.supplierSites': attachment(),
  'oracle_fusion_procurement.purchaseRequisitions': attachment(),
  'oracle_fusion_procurement.draftPurchaseOrders': attachment(),
  'oracle_fusion_procurement.purchaseOrders': attachment(),
  'oracle_fusion_procurement.purchaseOrderHeaders': attachment(),
  'oracle_fusion_procurement.purchaseOrderReceipts': attachment(),
  'oracle_fusion_procurement.supplierNegotiations': attachment(),
  'oracle_fusion_procurement.supplierNegotiationIds': attachment(),
  'oracle_fusion_procurement.supplierNegotiationResponses': attachment(),
  'oracle_fusion_procurement.procurementAgents': attachment(),
  'oracle_fusion_procurement.buyers': attachment(),
  'oracle_fusion_procurement.procurementBusinessUnits': attachment(),
  'oracle_fusion_procurement.procurementPersons': attachment(),
  'oracle_fusion_procurement.purchasingDocumentStyles': attachment(),
  'oracle_fusion_procurement.supplierAddresses': attachment(),
} satisfies ServerSelectorAttachmentMap
