import {
  type OracleFusionResolvedCredential,
  requestOracleFusionEmpty,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import type { OracleFusionResourceAddress } from '@/lib/internal/oracle-fusion/paths'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
} from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'
import {
  type OracleFusionServiceAuth,
  type OracleFusionServiceInput,
  type OracleFusionServiceResource,
  type OracleFusionServiceToolId,
  oracleFusionServiceOperationDefinitions,
  oracleFusionServiceResourceSchemas,
  parseOracleFusionServiceInput,
} from '@/lib/internal/oracle-fusion-service/schema'
import type {
  OracleFusionServiceRecord,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'

const RESOURCE_DEFINITIONS = {
  request: { path: 'serviceRequests', key: 'SrNumber', child: false, param: 'srNumber' },
  accounts: { path: 'accounts', key: 'PartyNumber', child: false, param: 'partyNumber' },
  contacts: { path: 'contacts', key: 'PartyNumber', child: false, param: 'partyNumber' },
  queues: { path: 'queues', key: 'QueueId', child: false, param: 'queueId' },
  resources: { path: 'resources', key: 'PartyNumber', child: false, param: 'partyNumber' },
  businessUnits: {
    path: 'serviceBusinessUnits',
    key: 'BUOrgId',
    child: false,
    param: 'businessUnitId',
  },
  statuses: {
    path: 'serviceRequestStatusesLOV',
    key: 'LookupCode',
    child: false,
    param: undefined,
  },
  requestContacts: { path: 'contacts', key: 'MemberId', child: true, param: 'memberId' },
  requestResources: { path: 'resourceMembers', key: 'MemberId', child: true, param: 'memberId' },
  messages: { path: 'messages', key: 'MessageId', child: true, param: 'messageId' },
  interactions: {
    path: 'srInteractionReferences',
    key: 'ReferenceId',
    child: true,
    param: 'referenceId',
  },
} as const

export const ORACLE_FUSION_SERVICE_STATUS_FINDER =
  'IsEnabledFinder;BindChildLookupType=ORA_SVC_SR_STATUS_CD,BindParentLookupType=ORA_SVC_SR_STATUS_TYPE_CD'

function collectionAddress(
  resource: OracleFusionServiceResource,
  srNumber?: string
): OracleFusionResourceAddress {
  const definition = RESOURCE_DEFINITIONS[resource]
  if (definition.child && !srNumber) throw new Error('Service request number is required')
  return {
    family: 'crm',
    relativePath: definition.child
      ? `serviceRequests/${encodeOracleFusionPathSegment(srNumber!)}/child/${definition.path}`
      : definition.path,
  }
}

function parseResource(
  resource: OracleFusionServiceResource,
  value: unknown,
  auth: OracleFusionServiceAuth,
  collection: OracleFusionResourceAddress,
  expectedKey?: string
): OracleFusionServiceRecord {
  const parsed = oracleFusionServiceResourceSchemas[resource].safeParse(value)
  if (!parsed.success) throw new Error('Invalid Oracle Fusion Service response')
  const selfKey = extractOracleFusionOpaqueKey(value, auth.instanceUrl, collection)
  const key = (parsed.data as Record<string, unknown>)[RESOURCE_DEFINITIONS[resource].key]
  // Status LOV rows have a composite URL key, while their selectable value is LookupCode.
  if (
    resource !== 'statuses' &&
    (key !== selfKey || (expectedKey !== undefined && key !== expectedKey))
  ) {
    throw new Error('Oracle Fusion Service response identity does not match the requested resource')
  }
  return parsed.data
}

export async function listOracleFusionServiceResource(
  resource: OracleFusionServiceResource,
  input: OracleFusionServiceAuth & {
    srNumber?: string
    q?: string
    orderBy?: string
    limit?: number
    offset?: number
    totalResults?: boolean
  },
  signal?: AbortSignal
) {
  const address = collectionAddress(resource, input.srNumber)
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const value = await requestOracleFusionJson(
    input,
    {
      address,
      query: {
        ...(resource === 'statuses'
          ? { finder: ORACLE_FUSION_SERVICE_STATUS_FINDER }
          : { q: input.q, orderBy: input.orderBy }),
        limit,
        offset,
        totalResults: input.totalResults ?? false,
        fields: Object.keys(oracleFusionServiceResourceSchemas[resource].shape).join(','),
        links: 'self',
      },
    },
    signal
  )
  const page = parseOracleFusionCollection(
    value,
    (item) => parseResource(resource, item, input, address),
    { expectedOffset: offset, maxItems: limit }
  )
  return { ...page, nextOffset: page.hasMore ? page.nextOffset : undefined }
}

export async function getOracleFusionServiceResource(
  resource: OracleFusionServiceResource,
  input: OracleFusionServiceAuth & { key: string; srNumber?: string },
  signal?: AbortSignal
) {
  const collection = collectionAddress(resource, input.srNumber)
  const value = await requestOracleFusionJson(
    input,
    {
      address: {
        ...collection,
        relativePath: `${collection.relativePath}/${encodeOracleFusionPathSegment(input.key)}`,
      },
      query: {
        fields: Object.keys(oracleFusionServiceResourceSchemas[resource].shape).join(','),
        links: 'self',
      },
    },
    signal
  )
  return parseResource(resource, value, input, collection, input.key)
}

const BODY_FIELDS = {
  title: 'Title',
  problemDescription: 'ProblemDescription',
  businessUnitId: 'BUOrgId',
  accountPartyId: 'AccountPartyId',
  contactPartyId: 'PrimaryContactPartyId',
  resourcePartyId: 'AssigneeResourceId',
  queueId: 'QueueId',
  statusCode: 'StatusCd',
  severityCode: 'SeverityCd',
  channelTypeCode: 'ChannelTypeCd',
  resolveDescription: 'ResolveDescription',
  resolveOutcomeCode: 'ResolveOutcomeCd',
  resolutionCode: 'ResolutionCd',
  accessLevelCode: 'AccessLevelCd',
  relationTypeCode: 'RelationTypeCd',
  primaryContact: 'PrimaryContactFlag',
  owner: 'OwnerFlag',
} as const

function writeBody(
  resource: OracleFusionServiceResource,
  input: OracleFusionServiceInput
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [param, field] of Object.entries(BODY_FIELDS)) {
    const value = input[param as keyof typeof BODY_FIELDS]
    if (value === undefined) continue
    const target =
      resource === 'requestContacts' && param === 'contactPartyId'
        ? 'PartyId'
        : resource === 'requestResources' && param === 'resourcePartyId'
          ? 'ObjectId'
          : field
    body[target] = target.endsWith('Id') ? oracleFusionExactInteger(String(value)) : value
  }
  return body
}

export async function executeOracleFusionServiceOperation(
  toolId: OracleFusionServiceToolId,
  rawInput: unknown,
  signal?: AbortSignal
): Promise<OracleFusionServiceResponse> {
  const input = parseOracleFusionServiceInput(toolId, rawInput)
  const definition = oracleFusionServiceOperationDefinitions[toolId]
  const resource = definition.resource
  const auth: OracleFusionResolvedCredential = {
    instanceUrl: input.instanceUrl,
    accessToken: input.accessToken,
  }
  if (definition.kind === 'list') {
    return { success: true, output: await listOracleFusionServiceResource(resource, input, signal) }
  }
  const collection = collectionAddress(resource, input.srNumber)
  const keyParam = RESOURCE_DEFINITIONS[resource].param
  const key = keyParam ? input[keyParam] : undefined
  if (definition.kind === 'get') {
    if (!key) throw new Error('Oracle resource key is required')
    return {
      success: true,
      output: {
        item: await getOracleFusionServiceResource(
          resource,
          { ...auth, srNumber: input.srNumber, key },
          signal
        ),
      },
    }
  }
  if (definition.kind === 'action') {
    const response = await requestOracleFusionJson(
      auth,
      {
        address: { family: 'crm', relativePath: 'serviceRequests/action/runQueueAssignment' },
        method: 'POST',
        mediaType: 'application/vnd.oracle.adf.action+json',
        body: {
          srNumber: input.srNumber,
          ...(input.overrideQueue === undefined ? {} : { overrideQueueFlag: input.overrideQueue }),
        },
      },
      signal
    )
    if (
      !response ||
      typeof response !== 'object' ||
      !('result' in response) ||
      typeof response.result !== 'string'
    ) {
      throw new Error('Invalid Oracle queue assignment result')
    }
    return { success: true, output: { result: response.result } }
  }
  const address =
    definition.kind === 'create'
      ? collection
      : {
          ...collection,
          relativePath: `${collection.relativePath}/${encodeOracleFusionPathSegment(key!)}`,
        }
  const operationHeaders = input.ifMatch === undefined ? undefined : { ifMatch: input.ifMatch }
  if (definition.kind === 'delete') {
    await requestOracleFusionEmpty(auth, { address, method: 'DELETE', operationHeaders }, signal)
    return { success: true, output: { deleted: true } }
  }
  const response = await requestOracleFusionJson(
    auth,
    {
      address,
      method: definition.kind === 'create' ? 'POST' : 'PATCH',
      mediaType: 'application/vnd.oracle.adf.resourceitem+json',
      operationHeaders,
      body: writeBody(resource, input),
    },
    signal
  )
  return {
    success: true,
    output: {
      item: parseResource(
        resource,
        response,
        auth,
        collection,
        definition.kind === 'update' ? key : undefined
      ),
    },
  }
}
