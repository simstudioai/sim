import {
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
  encodeOracleFusionSubscriptionPublicKey,
  projectOracleFusionSubscriptionRecord,
  readOracleFusionSubscriptionDecimal,
  readOracleFusionSubscriptionObject,
} from '@/lib/internal/oracle-fusion-subscription-management/projectors'
import {
  type OracleFusionSubscriptionInput,
  oracleFusionSubscriptionIdSchema,
  oracleFusionSubscriptionKeySchema,
  oracleFusionSubscriptionPageSchema,
  oracleFusionSubscriptionPublicKeySchema,
  parseOracleFusionSubscriptionInput,
} from '@/lib/internal/oracle-fusion-subscription-management/schema'
import {
  getOracleFusionSubscriptionFields,
  getOracleFusionSubscriptionOperation,
  ORACLE_FUSION_SUBSCRIPTION_ENTITIES,
} from '@/tools/oracle_fusion_subscription_management/shared'
import type {
  OracleFusionSubscriptionPageParams,
  OracleFusionSubscriptionRecord,
  OracleFusionSubscriptionResponse,
} from '@/tools/oracle_fusion_subscription_management/types'

type RecordInput = OracleFusionResolvedCredential & Record<string, unknown>
type PageInput = RecordInput & OracleFusionSubscriptionPageParams

function entityDefinition(name: string) {
  if (!Object.hasOwn(ORACLE_FUSION_SUBSCRIPTION_ENTITIES, name)) {
    throw new Error('Unsupported subscription resource')
  }
  return ORACLE_FUSION_SUBSCRIPTION_ENTITIES[name]
}

/** Only fixed, documented subscription routes can be selected. */
function collectionPath(entityName: string, input: RecordInput): string {
  const entity = entityDefinition(entityName)
  const key = (param: string) =>
    encodeOracleFusionSubscriptionPublicKey(
      oracleFusionSubscriptionPublicKeySchema.parse(input[param])
    )
  if (entity.parents.length === 0) return entity.resource
  const subscription = `subscriptions/${key('subscriptionNumber')}`
  if (entityName === 'product' || entityName === 'validationResult') {
    return `${subscription}/child/${entity.resource}`
  }
  const product = `${subscription}/child/products/${key('subscriptionProductPuid')}`
  if (entityName === 'coveredLevel' || entityName === 'associatedAsset') {
    return `${product}/child/${entity.resource}`
  }
  if (entityName === 'childCoveredLevel') {
    return `${product}/child/coveredLevels/${key('coveredLevelPuid')}/child/childCoveredLevels`
  }
  const parent =
    input.billingScope === 'covered_level'
      ? `${product}/child/coveredLevels/${key('coveredLevelPuid')}`
      : product
  if (entityName === 'chargeAdjustment') {
    return `${parent}/child/charges/${key('chargePuid')}/child/adjustments`
  }
  if (entityName === 'billAdjustment') {
    return `${parent}/child/billLines/${key('billLinePuid')}/child/billAdjustments`
  }
  return `${parent}/child/${entity.resource}`
}

function projectRecord(
  data: unknown,
  entityName: string,
  input: RecordInput,
  collection: string,
  expectedKey?: string
) {
  const record = projectOracleFusionSubscriptionRecord(
    data,
    entityName,
    input,
    collection,
    expectedKey
  )
  if (
    entityName === 'product' &&
    record.SubscriptionNumber != null &&
    record.SubscriptionNumber !== input.subscriptionNumber
  ) {
    throw new OracleFusionProviderError('Oracle returned a product for another subscription', 502)
  }
  return record
}

/** One bounded page, shared with selectors; next links are never followed. */
export async function listOracleFusionSubscriptionRecords(
  entityName: string,
  input: PageInput,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const entity = entityDefinition(entityName)
  const page = oracleFusionSubscriptionPageSchema.parse(input)
  const collection = collectionPath(entityName, input)
  const fields = Object.keys(entity.outputProperties).filter((field) => field !== 'resourceKey')
  const data = await requestOracleFusionJson(
    input,
    {
      address: { family: 'crm', relativePath: collection },
      query: { ...page, fields: fields.join(','), links: 'self' },
    },
    signal
  )
  signal?.throwIfAborted()
  const result = parseOracleFusionCollection(
    data,
    (item) => projectRecord(item, entityName, input, collection),
    { expectedOffset: page.offset, maxItems: page.limit }
  )
  const { nextOffset, ...rest } = result
  return { ...rest, ...(result.hasMore ? { nextOffset } : {}) }
}

export async function getOracleFusionSubscriptionRecord(
  entityName: string,
  input: RecordInput,
  rawKey: unknown,
  signal?: AbortSignal
): Promise<OracleFusionSubscriptionRecord> {
  signal?.throwIfAborted()
  const entity = entityDefinition(entityName)
  const key = (
    entity.publicKey ? oracleFusionSubscriptionPublicKeySchema : oracleFusionSubscriptionKeySchema
  ).parse(rawKey)
  const encoded = entity.publicKey
    ? encodeOracleFusionSubscriptionPublicKey(key)
    : encodeOracleFusionPathSegment(key)
  const collection = collectionPath(entityName, input)
  const fields = Object.keys(entity.outputProperties).filter((field) => field !== 'resourceKey')
  const data = await requestOracleFusionJson(
    input,
    {
      address: { family: 'crm', relativePath: `${collection}/${encoded}` },
      query: { fields: fields.join(','), links: 'self' },
    },
    signal
  )
  signal?.throwIfAborted()
  return projectRecord(data, entityName, input, collection, key)
}

/** Nested creates must use the canonical numeric IDs belonging to their route parents. */
async function addParentIds(
  entityName: string,
  input: OracleFusionSubscriptionInput,
  body: Record<string, unknown>,
  signal?: AbortSignal
) {
  if (entityName === 'subscription') return
  if (entityName === 'product') {
    const parent = await getOracleFusionSubscriptionRecord(
      'subscription',
      input,
      input.subscriptionNumber,
      signal
    )
    body.SubscriptionId = oracleFusionExactInteger(
      oracleFusionSubscriptionIdSchema.parse(parent.SubscriptionId)
    )
    return
  }
  const parentEntity = entityName === 'chargeAdjustment' ? 'charge' : 'product'
  const parentKey =
    entityName === 'chargeAdjustment' ? input.chargePuid : input.subscriptionProductPuid
  const parent = await getOracleFusionSubscriptionRecord(parentEntity, input, parentKey, signal)
  for (const field of ['SubscriptionId', 'SubscriptionProductId']) {
    body[field] = oracleFusionExactInteger(oracleFusionSubscriptionIdSchema.parse(parent[field]))
  }
  if (entityName === 'chargeAdjustment') {
    body.ChargeId = oracleFusionExactInteger(
      oracleFusionSubscriptionIdSchema.parse(parent.ChargeId)
    )
  }
  if (entityName === 'charge' && input.billingScope === 'covered_level') {
    const covered = await getOracleFusionSubscriptionRecord(
      'coveredLevel',
      input,
      input.coveredLevelPuid,
      signal
    )
    if (
      covered.SubscriptionId !== parent.SubscriptionId ||
      covered.SubscriptionProductId !== parent.SubscriptionProductId
    ) {
      throw new OracleFusionProviderError('Oracle returned coverage for another product', 502)
    }
    body.CoveredLevelId = oracleFusionExactInteger(
      oracleFusionSubscriptionIdSchema.parse(covered.CoveredLevelId)
    )
  }
}

function requestBody(name: string, input: OracleFusionSubscriptionInput): Record<string, unknown> {
  const fields = getOracleFusionSubscriptionFields(getOracleFusionSubscriptionOperation(name))
  const body: Record<string, unknown> = {}
  for (const field of fields) {
    const value = input[field.param]
    if (value === undefined) continue
    body[field.oracle] =
      value === null
        ? null
        : field.kind === 'id' || field.kind === 'ruleId'
          ? oracleFusionExactInteger(value as string)
          : value
  }
  return body
}

/** Execute one declared operation; lifecycle actions are never translated into PATCH. */
export async function executeOracleFusionSubscriptionOperation(
  name: string,
  rawInput: unknown,
  signal?: AbortSignal
): Promise<OracleFusionSubscriptionResponse> {
  signal?.throwIfAborted()
  const input = parseOracleFusionSubscriptionInput(name, rawInput)
  const operation = getOracleFusionSubscriptionOperation(name)
  const entity = entityDefinition(operation.entity)
  if (operation.kind === 'list') {
    return {
      success: true,
      output: await listOracleFusionSubscriptionRecords(operation.entity, input, signal),
    }
  }
  if (operation.kind === 'get') {
    return {
      success: true,
      output: {
        record: await getOracleFusionSubscriptionRecord(
          operation.entity,
          input,
          input[entity.keyParam],
          signal
        ),
      },
    }
  }
  const collection = collectionPath(operation.entity, input)
  const key = operation.kind === 'create' ? undefined : String(input[entity.keyParam])
  const path =
    key === undefined
      ? collection
      : collection +
        '/' +
        (entity.publicKey
          ? encodeOracleFusionSubscriptionPublicKey(key)
          : encodeOracleFusionPathSegment(key))
  if (operation.kind === 'delete') {
    await requestOracleFusionEmpty(
      input,
      { address: { family: 'crm', relativePath: path }, method: 'DELETE' },
      signal
    )
    signal?.throwIfAborted()
    return { success: true, output: { deleted: true } }
  }
  const body = requestBody(name, input)
  if (operation.kind === 'create') await addParentIds(operation.entity, input, body, signal)
  const data = await requestOracleFusionJson(
    input,
    {
      address: {
        family: 'crm',
        relativePath: operation.kind === 'action' ? `${path}/action/${operation.action}` : path,
      },
      method: operation.kind === 'update' ? 'PATCH' : 'POST',
      mediaType:
        operation.kind === 'action'
          ? 'application/vnd.oracle.adf.action+json'
          : 'application/vnd.oracle.adf.resourceitem+json',
      body,
    },
    signal
  )
  signal?.throwIfAborted()
  if (operation.kind === 'action') {
    const value = readOracleFusionSubscriptionObject(data).result
    const result =
      operation.result === 'number' ? readOracleFusionSubscriptionDecimal(value) : value
    if (typeof result !== 'string' && typeof result !== 'number') {
      throw new OracleFusionProviderError(
        'Oracle returned an invalid subscription action result',
        502
      )
    }
    if (operation.result === 'string' && typeof result !== 'string') {
      throw new OracleFusionProviderError(
        'Oracle returned an invalid subscription action result',
        502
      )
    }
    /** Before 26C these two actions can report validation failure with HTTP 200. */
    if (
      (operation.action === 'suspend' || operation.action === 'resume') &&
      typeof result === 'string' &&
      result.trim().toUpperCase() === 'FAILED'
    ) {
      throw new OracleFusionProviderError(
        'Oracle rejected the subscription product lifecycle request',
        400
      )
    }
    return { success: true, output: { result } }
  }
  return {
    success: true,
    output: { record: projectRecord(data, operation.entity, input, collection, key) },
  }
}
