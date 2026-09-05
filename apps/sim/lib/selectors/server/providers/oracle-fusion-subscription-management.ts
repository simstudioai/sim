import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import type { OracleFusionResolvedCredential } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  getOracleFusionSubscriptionRecord,
  listOracleFusionSubscriptionRecords,
} from '@/lib/internal/oracle-fusion-subscription-management/operations'
import {
  oracleFusionSubscriptionIdSchema,
  oracleFusionSubscriptionPublicKeySchema,
} from '@/lib/internal/oracle-fusion-subscription-management/schema'
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
import type { OracleFusionSubscriptionRecord } from '@/tools/oracle_fusion_subscription_management/types'

type SubscriptionSelectorKey = Extract<
  ServerSelectorKey,
  `oracleFusionSubscriptionManagement.${string}`
>
type PreparedCredential = OracleFusionResolvedCredential & { oauthCredential: string }

interface RecordSelector {
  entity: string
  idField: string
  labelField: string
  searchField?: string
  detailField?: string
  numeric: boolean
  parents?: readonly ('subscriptionNumber' | 'subscriptionProductPuid')[]
}

const SELECTORS: Record<string, RecordSelector> = {
  subscriptions: {
    entity: 'subscription',
    idField: 'SubscriptionNumber',
    labelField: 'SubscriptionNumber',
    detailField: 'Description',
    numeric: false,
  },
  products: {
    entity: 'product',
    idField: 'SubscriptionProductPuid',
    labelField: 'ProductName',
    detailField: 'LineNumber',
    numeric: false,
    parents: ['subscriptionNumber'],
  },
  coveredLevels: {
    entity: 'coveredLevel',
    idField: 'CoveredLevelPuid',
    labelField: 'CoveredLevelName',
    searchField: 'CoveredLevelPuid',
    detailField: 'AssetSerialNumber',
    numeric: false,
    parents: ['subscriptionNumber', 'subscriptionProductPuid'],
  },
  subscriptionProfiles: {
    entity: 'subscriptionProfile',
    idField: 'SubscriptionProfileId',
    labelField: 'SubscriptionProfileName',
    detailField: 'SubscriptionProfileDescription',
    numeric: true,
  },
  subscriptionItems: {
    entity: 'subscriptionItem',
    idField: 'InventoryItemId',
    labelField: 'ItemNumber',
    detailField: 'OrganizationCode',
    numeric: true,
  },
  subscriptionAssets: {
    entity: 'subscriptionAsset',
    idField: 'AssetId',
    labelField: 'AssetNumber',
    detailField: 'Description',
    numeric: true,
  },
  organizationCodes: {
    entity: 'organization',
    idField: 'OrganizationId',
    labelField: 'OrganizationCode',
    numeric: true,
  },
  billToAccounts: {
    entity: 'billToAccount',
    idField: 'CustAccountId',
    labelField: 'AccountNumber',
    detailField: 'AccountName',
    numeric: true,
  },
  billToSites: {
    entity: 'billToSite',
    idField: 'SiteUseId',
    labelField: 'PartySiteName',
    detailField: 'Address',
    numeric: true,
  },
}

function exactId(value?: string): string {
  const parsed = oracleFusionSubscriptionIdSchema.safeParse(value)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}

/** Quote ADF query literals and escape framework 9 LIKE wildcards. */
function searchExpression(field: string, search?: string): string | undefined {
  if (!search?.trim()) return undefined
  if (search.length > 256) throw new SelectorContextUnavailableError()
  const literal = search.trim().replace(/[\\%_*?]/g, (character) => `\\${character}`)
  return `${field} LIKE '%${literal.replaceAll("'", "''")}%'`
}

function offsetFromCursor(cursor?: string): number {
  if (cursor === undefined) return 0
  if (!/^(?:0|[1-9]\d{0,15})$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset) || offset > Number.MAX_SAFE_INTEGER - 100) {
    throw new SelectorContextUnavailableError()
  }
  return offset
}

function option(
  record: OracleFusionSubscriptionRecord,
  definition: RecordSelector
): SafeSelectorOption {
  const value = record[definition.idField]
  const parsed = (
    definition.numeric ? oracleFusionSubscriptionIdSchema : oracleFusionSubscriptionPublicKeySchema
  ).safeParse(value)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  const label = record[definition.labelField]
  const detail = definition.detailField ? record[definition.detailField] : undefined
  return {
    id: parsed.data,
    label: typeof label === 'string' && label.trim() ? label : parsed.data,
    ...(typeof detail === 'string' && detail ? { meta: { detail } } : {}),
  }
}

async function prepareCredential(args: ExecuteServerSelectorArgs): Promise<PreparedCredential> {
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!bundle.instanceUrl) throw new SelectorConnectionUnavailableError()
  const instanceUrl = normalizeOracleFusionApplicationOrigin(bundle.instanceUrl)
  const oauthCredential = args.credential?.access?.resolvedCredentialId
  if (!instanceUrl || !oauthCredential) throw new SelectorConnectionUnavailableError()
  return { instanceUrl, accessToken: bundle.accessToken, oauthCredential }
}

async function selectRecords(args: ExecuteServerSelectorArgs, credential: PreparedCredential) {
  const kind = args.selectorKey.slice('oracleFusionSubscriptionManagement.'.length)
  if (!Object.hasOwn(SELECTORS, kind)) throw new SelectorOptionsUnavailableError()
  const definition = SELECTORS[kind]
  const parents: Record<string, string> = {}
  for (const parent of definition.parents ?? []) {
    const parsed = oracleFusionSubscriptionPublicKeySchema.safeParse(args.context[parent])
    if (!parsed.success) throw new SelectorContextUnavailableError()
    parents[parent] = parsed.data
  }
  const input = { ...credential, ...parents }
  if (args.request.kind === 'detail' && !definition.numeric) {
    const record = await getOracleFusionSubscriptionRecord(
      definition.entity,
      input,
      args.request.id,
      args.signal
    )
    return detailSelectorResult(option(record, definition))
  }
  const filters: string[] = []
  let finder: string | undefined
  let organizationId: string | undefined
  let billToAccountId: string | undefined
  if (kind === 'subscriptionItems') {
    organizationId = exactId(args.context.orgId)
    finder = `SubscriptionItemsByOrganizationIdRowFinder;BindOrganizationId=${organizationId}`
  }
  if (kind === 'billToAccounts' && args.context.primaryPartyId !== undefined) {
    finder = `PrimaryPartyIdFinder;primaryPartyId=${exactId(args.context.primaryPartyId)}`
  }
  if (kind === 'billToSites') {
    billToAccountId = exactId(args.context.billToAccountId)
    filters.push(`CustAccountId=${billToAccountId}`)
  }
  const detailId = args.request.kind === 'detail' ? exactId(args.request.id) : undefined
  if (detailId !== undefined) {
    filters.push(`${definition.idField}=${detailId}`)
  } else if (args.request.kind === 'list') {
    const search = searchExpression(
      definition.searchField ?? definition.labelField,
      args.request.search
    )
    if (search) filters.push(search)
  }
  const page = await listOracleFusionSubscriptionRecords(
    definition.entity,
    {
      ...input,
      finder,
      q: filters.length ? filters.map((filter) => `(${filter})`).join(' and ') : undefined,
      limit: detailId === undefined ? 50 : 2,
      offset: args.request.kind === 'list' ? offsetFromCursor(args.request.cursor) : 0,
    },
    args.signal
  )
  for (const record of page.items) {
    if (
      (organizationId !== undefined && record.OrganizationId !== organizationId) ||
      (billToAccountId !== undefined && record.CustAccountId !== billToAccountId)
    ) {
      throw new SelectorOptionsUnavailableError()
    }
  }
  const items = page.items.map((record) => option(record, definition))
  if (detailId !== undefined) {
    if (page.hasMore || items.length > 1 || (items[0] && items[0].id !== detailId)) {
      throw new SelectorOptionsUnavailableError()
    }
    return detailSelectorResult(items[0] ?? null)
  }
  return listSelectorResult(
    items,
    page.nextOffset === undefined ? undefined : String(page.nextOffset)
  )
}

async function execute(args: ExecuteServerSelectorArgs, credential: PreparedCredential) {
  args.signal?.throwIfAborted()
  try {
    const result = await selectRecords(args, credential)
    args.signal?.throwIfAborted()
    return result
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      if (error.status === 404 && args.request.kind === 'detail') return detailSelectorResult(null)
      throw selectorProviderStatusError(error.status)
    }
    if (
      error instanceof SelectorContextUnavailableError ||
      error instanceof SelectorOptionsUnavailableError
    ) {
      throw error
    }
    throw new SelectorOptionsUnavailableError()
  }
}

const attachment = definePreparedSelectorAttachment({
  credential: {
    kind: 'stored',
    field: 'oauthCredential',
    serviceIds: ['oracle_fusion_subscription_management'],
  },
  integrationBlockTypes: ['oracle_fusion_subscription_management'],
  destination: { kind: 'credential-bound', prepare: prepareCredential },
  execute,
})

export const oracleFusionSubscriptionSelectorAttachments = {
  'oracleFusionSubscriptionManagement.subscriptions': attachment,
  'oracleFusionSubscriptionManagement.products': attachment,
  'oracleFusionSubscriptionManagement.coveredLevels': attachment,
  'oracleFusionSubscriptionManagement.subscriptionProfiles': attachment,
  'oracleFusionSubscriptionManagement.subscriptionItems': attachment,
  'oracleFusionSubscriptionManagement.subscriptionAssets': attachment,
  'oracleFusionSubscriptionManagement.organizationCodes': attachment,
  'oracleFusionSubscriptionManagement.billToAccounts': attachment,
  'oracleFusionSubscriptionManagement.billToSites': attachment,
} satisfies ServerSelectorAttachmentMap<SubscriptionSelectorKey>
