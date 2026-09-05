import { ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  getOracleFusionScmResource,
  listOracleFusionScmResource,
} from '@/lib/internal/oracle-fusion-scm/operations'
import {
  type OracleFusionScmAuthInput,
  type OracleFusionScmResource,
  oracleFusionScmOpaqueKeySchema,
} from '@/lib/internal/oracle-fusion-scm/schema'
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
import type { SafeOptionMeta, SafeSelectorOption } from '@/lib/selectors/types'

type OracleFusionScmSelectorKey = Extract<ServerSelectorKey, `oracleFusionScm.${string}`>

const PAGE_SIZE = 50

interface SelectorDefinition {
  resource: OracleFusionScmResource
  parentKey?: string
  keyField: string
  labelFields: readonly string[]
  metaFields: Readonly<Record<string, string>>
}

const SELECTOR_DEFINITIONS = {
  'oracleFusionScm.salesOrderLines': {
    resource: 'salesOrderLines',
    keyField: 'salesOrderLineKey',
    parentKey: 'salesOrderKey',
    labelFields: ['LineNumber', 'ProductNumber'],
    metaFields: {},
  },
  'oracleFusionScm.salesOrders': {
    resource: 'salesOrders',
    keyField: 'salesOrderKey',
    labelFields: ['OrderNumber', 'BuyingPartyName'],
    metaFields: {},
  },
  'oracleFusionScm.transferOrderLines': {
    resource: 'transferOrderLines',
    keyField: 'transferOrderLineKey',
    parentKey: 'transferOrderKey',
    labelFields: ['LineNumber', 'ItemNumber'],
    metaFields: {},
  },
  'oracleFusionScm.transferOrders': {
    resource: 'transferOrders',
    keyField: 'transferOrderKey',
    labelFields: ['HeaderNumber', 'Description'],
    metaFields: {},
  },
  'oracleFusionScm.shipmentLines': {
    resource: 'shipmentLines',
    keyField: 'shipmentLineKey',
    labelFields: ['ShipmentLine', 'Item', 'Shipment'],
    metaFields: {},
  },
  'oracleFusionScm.supplyOrderLines': {
    resource: 'supplyOrderLines',
    keyField: 'supplyOrderLineKey',
    parentKey: 'supplyRequestKey',
    labelFields: ['SupplyLineNumber', 'ItemNumber'],
    metaFields: {},
  },
  'oracleFusionScm.inventoryOrganizations': {
    resource: 'inventoryOrganizations',
    keyField: 'organizationKey',
    labelFields: ['OrganizationName', 'OrganizationCode'],
    metaFields: { code: 'OrganizationCode', status: 'Status' },
  },
  'oracleFusionScm.items': {
    resource: 'items',
    keyField: 'itemKey',
    labelFields: ['ItemNumber', 'ItemDescription'],
    metaFields: { organizationCode: 'OrganizationCode', status: 'ItemStatusValue' },
  },
  'oracleFusionScm.supplyRequests': {
    resource: 'supplyRequests',
    keyField: 'supplyRequestKey',
    labelFields: ['SupplyOrderNumber', 'SupplyOrderReferenceNumber'],
    metaFields: { status: 'SupplyRequestStatus', requestDate: 'SupplyRequestDate' },
  },
  'oracleFusionScm.shipments': {
    resource: 'shipments',
    keyField: 'shipmentKey',
    labelFields: ['Shipment', 'ShipmentDescription'],
    metaFields: {
      status: 'ShipmentStatus',
      organizationCode: 'OrganizationCode',
      actualShipDate: 'ActualShipDate',
    },
  },
  'oracleFusionScm.manufacturingWorkOrders': {
    resource: 'manufacturingWorkOrders',
    keyField: 'manufacturingWorkOrderKey',
    labelFields: ['WorkOrderNumber', 'WorkOrderDescription'],
    metaFields: {
      status: 'WorkOrderStatusName',
      organizationCode: 'OrganizationCode',
      itemNumber: 'ItemNumber',
    },
  },
  'oracleFusionScm.maintenanceWorkOrders': {
    resource: 'maintenanceWorkOrders',
    keyField: 'maintenanceWorkOrderKey',
    labelFields: ['WorkOrderNumber', 'WorkOrderDescription'],
    metaFields: {
      status: 'WorkOrderStatus',
      organizationCode: 'OrganizationCode',
      assetNumber: 'AssetNumber',
    },
  },
} as const satisfies Record<OracleFusionScmSelectorKey, SelectorDefinition>

function parseOffset(cursor?: string): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset)) throw new SelectorContextUnavailableError()
  return offset
}

function selectorValue(value: unknown): SafeOptionMeta[string] | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : value === null
      ? null
      : undefined
}

function optionFromResource(
  item: Record<string, unknown>,
  definition: SelectorDefinition,
  expectedId?: string
): SafeSelectorOption {
  const id = item[definition.keyField]
  if (typeof id !== 'string' || !id || (expectedId !== undefined && id !== expectedId)) {
    throw new SelectorOptionsUnavailableError()
  }
  const labels = definition.labelFields.flatMap((field) => {
    const value = item[field]
    return typeof value === 'string' && value.trim() ? [value.trim()] : []
  })
  const meta = Object.fromEntries(
    Object.entries(definition.metaFields).flatMap(([name, field]) => {
      const value = selectorValue(item[field])
      return value === undefined ? [] : [[name, value]]
    })
  ) as SafeOptionMeta
  return {
    id,
    label: labels.length ? labels.join(' — ') : id,
    ...(Object.keys(meta).length ? { meta } : {}),
  }
}

async function prepareDestination(
  args: ExecuteServerSelectorArgs
): Promise<OracleFusionScmAuthInput> {
  if (
    !args.credential?.access?.resolvedCredentialId ||
    args.credential.access.credentialType !== 'service_account' ||
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
  if (error instanceof OracleFusionProviderError) throw selectorProviderStatusError(error.status)
  if (
    error instanceof SelectorContextUnavailableError ||
    error instanceof SelectorConnectionUnavailableError ||
    error instanceof SelectorOptionsUnavailableError
  ) {
    throw error
  }
  throw new SelectorOptionsUnavailableError()
}

async function executeSelector(args: ExecuteServerSelectorArgs, auth: OracleFusionScmAuthInput) {
  const definition: SelectorDefinition =
    SELECTOR_DEFINITIONS[args.selectorKey as OracleFusionScmSelectorKey]
  if (!definition) throw new SelectorOptionsUnavailableError()
  try {
    const parentKey = definition.parentKey
      ? oracleFusionScmOpaqueKeySchema.safeParse(args.context.collectionId)
      : undefined
    if (parentKey && !parentKey.success) throw new SelectorContextUnavailableError()
    const parent =
      definition.parentKey && parentKey?.success ? { [definition.parentKey]: parentKey.data } : {}
    if (args.request.kind === 'detail') {
      const parsedId = oracleFusionScmOpaqueKeySchema.safeParse(args.request.id)
      if (!parsedId.success) throw new SelectorContextUnavailableError()
      const item = await getOracleFusionScmResource(
        definition.resource,
        { ...auth, ...parent, key: parsedId.data },
        args.signal
      )
      return detailSelectorResult(optionFromResource(item, definition, parsedId.data))
    }

    if (args.request.search !== undefined) throw new SelectorContextUnavailableError()
    const offset = parseOffset(args.request.cursor)
    const page = await listOracleFusionScmResource(
      definition.resource,
      { ...auth, ...parent, limit: PAGE_SIZE, offset, totalResults: false },
      args.signal
    )
    return listSelectorResult(
      page.items.map((item) => optionFromResource(item, definition)),
      page.nextOffset === undefined ? undefined : String(page.nextOffset)
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (
      args.request.kind === 'detail' &&
      error instanceof OracleFusionProviderError &&
      error.status === 404
    ) {
      return detailSelectorResult(null)
    }
    mapProviderError(error)
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle_fusion_scm'],
} as const

function attachment() {
  return definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes: ['oracle_fusion_scm'],
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  })
}

export const oracleFusionScmSelectorAttachments = {
  'oracleFusionScm.salesOrderLines': attachment(),
  'oracleFusionScm.salesOrders': attachment(),
  'oracleFusionScm.transferOrderLines': attachment(),
  'oracleFusionScm.transferOrders': attachment(),
  'oracleFusionScm.shipmentLines': attachment(),
  'oracleFusionScm.supplyOrderLines': attachment(),
  'oracleFusionScm.inventoryOrganizations': attachment(),
  'oracleFusionScm.items': attachment(),
  'oracleFusionScm.supplyRequests': attachment(),
  'oracleFusionScm.shipments': attachment(),
  'oracleFusionScm.manufacturingWorkOrders': attachment(),
  'oracleFusionScm.maintenanceWorkOrders': attachment(),
} satisfies ServerSelectorAttachmentMap<OracleFusionScmSelectorKey>
