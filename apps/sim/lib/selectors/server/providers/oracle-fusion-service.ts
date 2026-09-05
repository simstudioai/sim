import { ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  getOracleFusionServiceResource,
  listOracleFusionServiceResource,
} from '@/lib/internal/oracle-fusion-service/operations'
import {
  type OracleFusionServiceAuth,
  type OracleFusionServiceResource,
  oracleFusionServiceIdSchema,
  oracleFusionServiceNumberSchema,
} from '@/lib/internal/oracle-fusion-service/schema'
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
import type { OracleFusionServiceRecord } from '@/tools/oracle_fusion_service/types'

type OracleFusionServiceSelectorKey = Extract<
  ServerSelectorKey,
  | 'oracleFusionService.serviceRequests'
  | 'oracleFusionService.queues'
  | 'oracleFusionService.accounts'
  | 'oracleFusionService.contacts'
  | 'oracleFusionService.resources'
  | 'oracleFusionService.statuses'
  | 'oracleFusionService.businessUnits'
>

interface SelectorDefinition {
  resource: OracleFusionServiceResource
  idField: string
  labelFields: readonly string[]
  partyLookup?: boolean
}

const DEFINITIONS: Record<OracleFusionServiceSelectorKey, SelectorDefinition> = {
  'oracleFusionService.serviceRequests': {
    resource: 'request',
    idField: 'SrNumber',
    labelFields: ['SrNumber', 'Title'],
  },
  'oracleFusionService.queues': {
    resource: 'queues',
    idField: 'QueueId',
    labelFields: ['QueueName'],
  },
  'oracleFusionService.accounts': {
    resource: 'accounts',
    idField: 'PartyId',
    labelFields: ['OrganizationName', 'PartyNumber'],
    partyLookup: true,
  },
  'oracleFusionService.contacts': {
    resource: 'contacts',
    idField: 'PartyId',
    labelFields: ['ContactName', 'PartyNumber'],
    partyLookup: true,
  },
  'oracleFusionService.resources': {
    resource: 'resources',
    idField: 'PartyId',
    labelFields: ['PartyName', 'Username'],
    partyLookup: true,
  },
  'oracleFusionService.statuses': {
    resource: 'statuses',
    idField: 'LookupCode',
    labelFields: ['Meaning', 'LookupCode'],
  },
  'oracleFusionService.businessUnits': {
    resource: 'businessUnits',
    idField: 'BUOrgId',
    labelFields: ['BusinessUnitName', 'Name'],
  },
}

function parseOffset(cursor?: string): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset)) throw new SelectorContextUnavailableError()
  return offset
}

function optionFromRecord(
  record: OracleFusionServiceRecord,
  definition: SelectorDefinition,
  expectedId?: string
): SafeSelectorOption {
  const fields: Record<string, unknown> = { ...record }
  const id = fields[definition.idField]
  if (typeof id !== 'string' || !id || (expectedId !== undefined && id !== expectedId)) {
    throw new SelectorOptionsUnavailableError()
  }
  const labels = definition.labelFields.flatMap((field) => {
    const value = fields[field]
    return typeof value === 'string' && value.trim() ? [value.trim()] : []
  })
  return { id, label: [...new Set(labels)].join(' — ') || id }
}

async function prepareDestination(
  args: ExecuteServerSelectorArgs
): Promise<OracleFusionServiceAuth> {
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

async function executeSelector(args: ExecuteServerSelectorArgs, auth: OracleFusionServiceAuth) {
  const definition = DEFINITIONS[args.selectorKey as OracleFusionServiceSelectorKey]
  if (!definition) throw new SelectorOptionsUnavailableError()
  try {
    args.signal?.throwIfAborted()
    if (args.request.kind === 'detail') {
      if (definition.resource === 'statuses') throw new SelectorContextUnavailableError()
      const schema =
        definition.resource === 'request'
          ? oracleFusionServiceNumberSchema
          : oracleFusionServiceIdSchema
      const parsed = schema.safeParse(args.request.id)
      if (!parsed.success) throw new SelectorContextUnavailableError()
      // Directory routes take PartyNumber, but assignment needs PartyId. Resolve by the
      // documented queryable PartyId field, never substitute it into a PartyNumber route.
      if (definition.partyLookup) {
        const page = await listOracleFusionServiceResource(
          definition.resource,
          {
            ...auth,
            q: `PartyId=${parsed.data}`,
            limit: 2,
            offset: 0,
          },
          args.signal
        )
        if (page.hasMore || page.items.length > 1) throw new SelectorOptionsUnavailableError()
        return detailSelectorResult(
          page.items[0] ? optionFromRecord(page.items[0], definition, parsed.data) : null
        )
      }
      const item = await getOracleFusionServiceResource(
        definition.resource,
        { ...auth, key: parsed.data },
        args.signal
      )
      return detailSelectorResult(optionFromRecord(item, definition, parsed.data))
    }
    if (args.request.search !== undefined) throw new SelectorContextUnavailableError()
    const page = await listOracleFusionServiceResource(
      definition.resource,
      {
        ...auth,
        limit: 50,
        offset: parseOffset(args.request.cursor),
        totalResults: false,
      },
      args.signal
    )
    return listSelectorResult(
      page.items.map((item) => optionFromRecord(item, definition)),
      page.nextOffset === undefined ? undefined : String(page.nextOffset)
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      if (args.request.kind === 'detail' && error.status === 404) return detailSelectorResult(null)
      throw selectorProviderStatusError(error.status)
    }
    if (
      error instanceof SelectorContextUnavailableError ||
      error instanceof SelectorConnectionUnavailableError ||
      error instanceof SelectorOptionsUnavailableError
    )
      throw error
    throw new SelectorOptionsUnavailableError()
  }
}

function attachment() {
  return definePreparedSelectorAttachment({
    credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oracle_fusion_service'] },
    integrationBlockTypes: ['oracle_fusion_service'],
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  })
}

export const oracleFusionServiceSelectorAttachments = {
  'oracleFusionService.serviceRequests': attachment(),
  'oracleFusionService.queues': attachment(),
  'oracleFusionService.accounts': attachment(),
  'oracleFusionService.contacts': attachment(),
  'oracleFusionService.resources': attachment(),
  'oracleFusionService.statuses': attachment(),
  'oracleFusionService.businessUnits': attachment(),
} satisfies ServerSelectorAttachmentMap<OracleFusionServiceSelectorKey>
