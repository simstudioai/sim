import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import type { OracleFusionResolvedCredential } from '@/lib/internal/oracle-fusion/client'
import { requestOracleFusionJson } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { parseOracleFusionCollection } from '@/lib/internal/oracle-fusion/protocol'
import {
  executeOracleFusionSalesOperation,
  listOracleFusionSalesRecords,
} from '@/lib/internal/oracle-fusion-sales/operations'
import {
  readOracleFusionSalesId,
  readOracleFusionSalesObject,
} from '@/lib/internal/oracle-fusion-sales/projectors'
import {
  oracleFusionSalesIdSchema,
  oracleFusionSalesKeySchema,
  oracleFusionSalesPublicNumberSchema,
} from '@/lib/internal/oracle-fusion-sales/schema'
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
import type { OracleFusionSalesRecord } from '@/tools/oracle_fusion_sales/types'

type SalesSelectorKey = Extract<ServerSelectorKey, `oracleFusionSales.${string}`>
type PreparedSalesCredential = OracleFusionResolvedCredential & { oauthCredential: string }

interface RecordSelector {
  entity: string
  idField: string
  labelField: string
  detailField?: string
  getOperation: string
  keyParam: string
  numericId?: boolean
}

const RECORD_SELECTORS: Record<string, RecordSelector> = {
  accounts: {
    entity: 'account',
    idField: 'PartyNumber',
    labelField: 'OrganizationName',
    detailField: 'EmailAddress',
    getOperation: 'get_account',
    keyParam: 'accountNumber',
  },
  accountIds: {
    entity: 'account',
    idField: 'PartyId',
    labelField: 'OrganizationName',
    detailField: 'PartyNumber',
    getOperation: 'get_account',
    keyParam: 'accountNumber',
    numericId: true,
  },
  contacts: {
    entity: 'contact',
    idField: 'PartyNumber',
    labelField: 'ContactName',
    detailField: 'EmailAddress',
    getOperation: 'get_contact',
    keyParam: 'contactNumber',
  },
  contactIds: {
    entity: 'contact',
    idField: 'PartyId',
    labelField: 'ContactName',
    detailField: 'EmailAddress',
    getOperation: 'get_contact',
    keyParam: 'contactNumber',
    numericId: true,
  },
  leads: {
    entity: 'lead',
    idField: 'resourceKey',
    labelField: 'Name',
    detailField: 'LeadNumber',
    getOperation: 'get_lead',
    keyParam: 'leadKey',
  },
  leadIds: {
    entity: 'lead',
    idField: 'LeadId',
    labelField: 'Name',
    detailField: 'LeadNumber',
    getOperation: 'get_lead',
    keyParam: 'leadKey',
    numericId: true,
  },
  opportunities: {
    entity: 'opportunity',
    idField: 'OptyNumber',
    labelField: 'Name',
    detailField: 'StatusCode',
    getOperation: 'get_opportunity',
    keyParam: 'opportunityNumber',
  },
  opportunityIds: {
    entity: 'opportunity',
    idField: 'OptyId',
    labelField: 'Name',
    detailField: 'OptyNumber',
    getOperation: 'get_opportunity',
    keyParam: 'opportunityNumber',
    numericId: true,
  },
  activities: {
    entity: 'activity',
    idField: 'ActivityNumber',
    labelField: 'Subject',
    detailField: 'ActivityFunctionCode',
    getOperation: 'get_activity',
    keyParam: 'activityNumber',
  },
  resources: {
    entity: 'resource',
    idField: 'PartyNumber',
    labelField: 'PartyName',
    detailField: 'EmailAddress',
    getOperation: 'get_sales_resource',
    keyParam: 'resourceNumber',
  },
  owners: {
    entity: 'resource',
    idField: 'PartyId',
    labelField: 'PartyName',
    detailField: 'EmailAddress',
    getOperation: 'get_sales_resource',
    keyParam: 'resourceNumber',
    numericId: true,
  },
}

const PAGE_SIZE = 50

function stringValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new SelectorOptionsUnavailableError()
  return value
}

function toRecordOption(
  record: OracleFusionSalesRecord,
  selector: RecordSelector
): SafeSelectorOption {
  const id = stringValue(record[selector.idField])
  const name = record[selector.labelField]
  const detail = selector.detailField ? record[selector.detailField] : undefined
  return {
    id,
    label: typeof name === 'string' && name.trim() ? name : id,
    ...(typeof detail === 'string' && detail ? { meta: { detail } } : {}),
  }
}

/** ADF framework 2+ doubles apostrophes; framework 9 permits escaping LIKE wildcards. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function searchExpression(field: string, search?: string): string | undefined {
  if (!search?.trim()) return undefined
  if (search.length > 256) throw new SelectorContextUnavailableError()
  const literal = search.trim().replace(/[\\%_*?]/g, (character) => `\\${character}`)
  return `${field} LIKE ${quote(`%${literal}%`)}`
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

function contextId(value?: string): string {
  const parsed = oracleFusionSalesIdSchema.safeParse(value)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}

async function prepareCredential(
  args: ExecuteServerSelectorArgs
): Promise<PreparedSalesCredential> {
  // The shared executor has already authorized and bound the stored credential to Sales.
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

async function recordSelector(
  args: ExecuteServerSelectorArgs,
  credential: PreparedSalesCredential,
  selector: RecordSelector
) {
  if (args.request.kind === 'detail') {
    const parsed = (
      selector.numericId
        ? oracleFusionSalesIdSchema
        : selector.entity === 'lead'
          ? oracleFusionSalesKeySchema
          : oracleFusionSalesPublicNumberSchema
    ).safeParse(args.request.id)
    if (!parsed.success) throw new SelectorContextUnavailableError()
    if (selector.numericId) {
      const result = await listOracleFusionSalesRecords(
        selector.entity,
        {
          ...credential,
          ...(selector.entity === 'opportunity'
            ? { finder: `PrimaryKey;OptyId=${parsed.data}` }
            : { q: `${selector.idField}=${parsed.data}` }),
          limit: 2,
          offset: 0,
        },
        args.signal
      )
      if (result.hasMore || result.items.length > 1) throw new SelectorOptionsUnavailableError()
      const record = result.items[0]
      if (record && record[selector.idField] !== parsed.data) {
        throw new SelectorOptionsUnavailableError()
      }
      return detailSelectorResult(record ? toRecordOption(record, selector) : null)
    }
    const response = await executeOracleFusionSalesOperation(
      selector.getOperation,
      {
        ...credential,
        [selector.keyParam]: parsed.data,
      },
      args.signal
    )
    const record = response.output.record
    if (!record) throw new SelectorOptionsUnavailableError()
    return detailSelectorResult(toRecordOption(record, selector))
  }
  const result = await listOracleFusionSalesRecords(
    selector.entity,
    {
      ...credential,
      q: searchExpression(selector.labelField, args.request.search),
      limit: PAGE_SIZE,
      offset: offsetFromCursor(args.request.cursor),
    },
    args.signal
  )
  return listSelectorResult(
    result.items.map((record) => toRecordOption(record, selector)),
    result.nextOffset === undefined ? undefined : String(result.nextOffset)
  )
}

interface LookupDefinition {
  path: string
  idField: string
  labelField: string
  finder: string
  numericId?: boolean
  detailField?: string
}

function lookupDefinition(kind: string, args: ExecuteServerSelectorArgs): LookupDefinition {
  if (kind === 'salesMethods') {
    return {
      path: 'salesMethodsLOV',
      idField: 'SalesMethodId',
      labelField: 'Name',
      numericId: true,
      detailField: 'DescriptionText',
      finder: `SalesMethodByBUFinder;BindBUId=${contextId(args.context.businessUnitId)}`,
    }
  }
  if (kind === 'salesStages') {
    return {
      path: 'salesStagesLOV',
      idField: 'StgId',
      labelField: 'Name',
      numericId: true,
      detailField: 'DescriptionText',
      finder: `SalesStageBySalesMethodFinder;BindSalesMethodId=${contextId(args.context.salesMethodId)}`,
    }
  }
  if (kind === 'opportunityStatuses') {
    return {
      path: 'optyStatusesLOV',
      idField: 'LookupCode',
      labelField: 'Meaning',
      detailField: 'Description',
      finder: `StatusByBUIdFinder;BindEnabledFlag=Y,BindLookupType=OPTY_STATUS,BindBUId=${contextId(args.context.businessUnitId)}`,
    }
  }
  const lookupType =
    kind === 'leadStatuses'
      ? 'MKL_LEAD_STATUS'
      : kind === 'activityStatuses'
        ? 'ZMM_ACTIVITY_STATUS_CD'
        : undefined
  if (!lookupType) throw new SelectorOptionsUnavailableError()
  return {
    path: 'fndStaticLookups',
    idField: 'LookupCode',
    labelField: 'Meaning',
    detailField: 'Description',
    finder: `LookupTypeActiveEnabledOrBindCodeFinder;BindLookupType=${lookupType}`,
  }
}

async function lookupSelector(
  kind: string,
  args: ExecuteServerSelectorArgs,
  credential: PreparedSalesCredential
) {
  const definition = lookupDefinition(kind, args)
  const detail = args.request.kind === 'detail'
  const id = args.request.kind === 'detail' ? args.request.id : undefined
  if (id !== undefined && (!id || id.length > 256)) throw new SelectorContextUnavailableError()
  const q =
    id === undefined
      ? searchExpression(
          definition.labelField,
          args.request.kind === 'list' ? args.request.search : undefined
        )
      : `${definition.idField}=${definition.numericId ? contextId(id) : quote(id)}`
  const offset = args.request.kind === 'list' ? offsetFromCursor(args.request.cursor) : 0
  const limit = detail ? 2 : PAGE_SIZE
  const data = await requestOracleFusionJson(
    credential,
    {
      address: { family: 'crm', relativePath: definition.path },
      query: {
        finder: definition.finder,
        q,
        offset,
        limit,
        fields: [definition.idField, definition.labelField, definition.detailField]
          .filter(Boolean)
          .join(','),
        onlyData: true,
      },
    },
    args.signal
  )
  const page = parseOracleFusionCollection(
    data,
    (value): SafeSelectorOption => {
      const record = readOracleFusionSalesObject(value)
      const id = definition.numericId
        ? readOracleFusionSalesId(record[definition.idField])
        : stringValue(record[definition.idField])
      const name = record[definition.labelField]
      const label = typeof name === 'string' && name.trim() ? name : id
      const detail = definition.detailField ? record[definition.detailField] : undefined
      return { id, label, ...(typeof detail === 'string' && detail ? { meta: { detail } } : {}) }
    },
    { expectedOffset: offset, maxItems: limit }
  )
  if (detail) {
    if (page.hasMore || page.items.length > 1 || (page.items[0] && page.items[0].id !== id)) {
      throw new SelectorOptionsUnavailableError()
    }
    return detailSelectorResult(page.items[0] ?? null)
  }
  return listSelectorResult(page.items, page.hasMore ? String(page.nextOffset) : undefined)
}

async function execute(args: ExecuteServerSelectorArgs, credential: PreparedSalesCredential) {
  args.signal?.throwIfAborted()
  const kind = args.selectorKey.slice('oracleFusionSales.'.length)
  try {
    const result = Object.hasOwn(RECORD_SELECTORS, kind)
      ? await recordSelector(args, credential, RECORD_SELECTORS[kind])
      : await lookupSelector(kind, args, credential)
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
    )
      throw error
    throw new SelectorOptionsUnavailableError()
  }
}

const attachment = definePreparedSelectorAttachment({
  credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oracle_fusion_sales'] },
  integrationBlockTypes: ['oracle_fusion_sales'],
  destination: { kind: 'credential-bound', prepare: prepareCredential },
  execute,
})

export const oracleFusionSalesSelectorAttachments = {
  'oracleFusionSales.accounts': attachment,
  'oracleFusionSales.accountIds': attachment,
  'oracleFusionSales.contacts': attachment,
  'oracleFusionSales.contactIds': attachment,
  'oracleFusionSales.leads': attachment,
  'oracleFusionSales.leadIds': attachment,
  'oracleFusionSales.opportunities': attachment,
  'oracleFusionSales.opportunityIds': attachment,
  'oracleFusionSales.activities': attachment,
  'oracleFusionSales.resources': attachment,
  'oracleFusionSales.owners': attachment,
  'oracleFusionSales.leadStatuses': attachment,
  'oracleFusionSales.opportunityStatuses': attachment,
  'oracleFusionSales.activityStatuses': attachment,
  'oracleFusionSales.salesMethods': attachment,
  'oracleFusionSales.salesStages': attachment,
} satisfies ServerSelectorAttachmentMap<SalesSelectorKey>
