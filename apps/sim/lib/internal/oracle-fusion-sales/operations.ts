import {
  type OracleFusionRequest,
  type OracleFusionResolvedCredential,
  requestOracleFusionEmpty,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  encodeOracleFusionPathSegment,
  parseOracleFusionCollection,
} from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'
import {
  encodeOracleFusionSalesPublicNumber,
  projectOracleFusionSalesDuplicates,
  projectOracleFusionSalesRecord,
  readOracleFusionSalesObject,
} from '@/lib/internal/oracle-fusion-sales/projectors'
import {
  type OracleFusionSalesInput,
  oracleFusionSalesPageSchema,
  parseOracleFusionSalesInput,
} from '@/lib/internal/oracle-fusion-sales/schema'
import {
  getOracleFusionSalesOperation,
  ORACLE_FUSION_SALES_ENTITIES,
} from '@/tools/oracle_fusion_sales/shared'
import type {
  OracleFusionSalesPageParams,
  OracleFusionSalesResponse,
} from '@/tools/oracle_fusion_sales/types'

type PageInput = OracleFusionResolvedCredential & OracleFusionSalesPageParams

function collectionPath(entityName: string, parentNumber?: unknown): string {
  const entity = ORACLE_FUSION_SALES_ENTITIES[entityName]
  if (!entity.parentParam) return entity.resource
  const parent = entity.parentParam === 'opportunityNumber' ? 'opportunities' : 'activities'
  return `${parent}/${encodeOracleFusionSalesPublicNumber(String(parentNumber))}/child/${entity.resource}`
}

/** Shared single-page primitive for tools and server selectors; never follows next links. */
export async function listOracleFusionSalesRecords(
  entityName: string,
  input: PageInput & { opportunityNumber?: string; activityNumber?: string },
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const entity = ORACLE_FUSION_SALES_ENTITIES[entityName]
  const page = oracleFusionSalesPageSchema.parse(input)
  const path = collectionPath(
    entityName,
    entity.parentParam === 'opportunityNumber' ? input.opportunityNumber : input.activityNumber
  )
  const fields = Object.keys(entity.outputProperties).filter((field) => field !== 'resourceKey')
  const data = await requestOracleFusionJson(
    input,
    {
      address: { family: 'crm', relativePath: path },
      query: {
        ...page,
        fields: fields.join(','),
        links: 'self',
      },
    },
    signal
  )
  signal?.throwIfAborted()
  const result = parseOracleFusionCollection(
    data,
    (item) => projectOracleFusionSalesRecord(item, entityName, input, path),
    { expectedOffset: page.offset, maxItems: page.limit }
  )
  const { nextOffset, ...rest } = result
  return { ...rest, ...(result.hasMore ? { nextOffset } : {}) }
}

function createBody(name: string, input: OracleFusionSalesInput): Record<string, unknown> {
  // ActivityDescription and ActivityMtgMinutes are CLOBs. Framework 8+ accepts plain
  // strings; the endpoint's legacy byte/Base64 descriptions predate that protocol.
  const operation = getOracleFusionSalesOperation(name)
  const entity = ORACLE_FUSION_SALES_ENTITIES[operation.entity]
  const body: Record<string, unknown> = {}
  for (const field of entity.fields) {
    if (operation.kind === 'update' && !field.update) continue
    const value = input[field.param]
    if (value === undefined) continue
    body[field.oracle] =
      value === null
        ? null
        : field.kind === 'id'
          ? oracleFusionExactInteger(value as string)
          : value
  }
  if (operation.functionCode) body.ActivityFunctionCode = operation.functionCode
  return body
}

function actionBody(name: string, input: OracleFusionSalesInput): Record<string, unknown> {
  const operation = getOracleFusionSalesOperation(name)
  if (operation.kind === 'duplicates') {
    return {
      [operation.entity === 'account' ? 'account' : 'contact']: input.matchingFields,
      ...(input.accountNumber === undefined ? {} : { accountPartyNumber: input.accountNumber }),
    }
  }
  if (operation.entity === 'account') return { partyNumber: input.accountNumber }
  if (operation.entity === 'opportunity') return { optyNumber: input.opportunityNumber }
  const body: Record<string, unknown> = {
    leadId: oracleFusionExactInteger(input.leadId as string),
  }
  const extras =
    name === 'reject_lead'
      ? ['reason', 'comments']
      : name === 'convert_lead'
        ? ['opportunityName', 'opportunityOwnerNumber', 'attributeMap']
        : []
  for (const key of extras) if (input[key] !== undefined) body[key] = input[key]
  return body
}

/** Executes only the 55 registered Sales workflows after Sales-specific request validation. */
export async function executeOracleFusionSalesOperation(
  name: string,
  rawInput: unknown,
  signal?: AbortSignal
): Promise<OracleFusionSalesResponse> {
  signal?.throwIfAborted()
  const input = parseOracleFusionSalesInput(name, rawInput)
  const operation = getOracleFusionSalesOperation(name)
  const entity = ORACLE_FUSION_SALES_ENTITIES[operation.entity]
  const collection = collectionPath(
    operation.entity,
    entity.parentParam ? input[entity.parentParam] : undefined
  )
  if (operation.kind === 'list') {
    const output = await listOracleFusionSalesRecords(operation.entity, input, signal)
    return { success: true, output }
  }
  if (operation.kind === 'action' || operation.kind === 'duplicates') {
    const data = await requestOracleFusionJson(
      input,
      {
        address: { family: 'crm', relativePath: `${collection}/action/${operation.action}` },
        method: 'POST',
        mediaType: 'application/vnd.oracle.adf.action+json',
        body: actionBody(name, input),
      },
      signal
    )
    signal?.throwIfAborted()
    if (operation.kind === 'duplicates') {
      const items = projectOracleFusionSalesDuplicates(data, operation.entity)
      return { success: true, output: { items, count: items.length } }
    }
    const result = readOracleFusionSalesObject(data).result
    if (typeof result !== 'string') {
      throw new OracleFusionProviderError(
        'Oracle Fusion Sales returned an invalid action result',
        502
      )
    }
    return { success: true, output: { result } }
  }
  const key = operation.kind === 'create' ? undefined : (input[entity.keyParam] as string)
  const path =
    key === undefined
      ? collection
      : `${collection}/${
          entity.publicKey
            ? encodeOracleFusionSalesPublicNumber(key)
            : encodeOracleFusionPathSegment(key)
        }`
  if (operation.kind === 'delete') {
    await requestOracleFusionEmpty(
      input,
      {
        address: { family: 'crm', relativePath: path },
        method: 'DELETE',
      },
      signal
    )
    signal?.throwIfAborted()
    return { success: true, output: { deleted: true } }
  }
  const request: OracleFusionRequest =
    operation.kind === 'get'
      ? { address: { family: 'crm', relativePath: path } }
      : {
          address: { family: 'crm', relativePath: path },
          method: operation.kind === 'create' ? 'POST' : 'PATCH',
          mediaType: 'application/vnd.oracle.adf.resourceitem+json',
          body: createBody(name, input),
        }
  const data = await requestOracleFusionJson(input, request, signal)
  signal?.throwIfAborted()
  const record = projectOracleFusionSalesRecord(data, operation.entity, input, collection, key)
  return { success: true, output: { record } }
}
