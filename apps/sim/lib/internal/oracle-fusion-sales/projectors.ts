import { isPlainRecord } from '@sim/utils/object'
import type { OracleFusionResolvedCredential } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import {
  getOracleFusionSalesDuplicateOutputs,
  ORACLE_FUSION_SALES_ENTITIES,
} from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesRecord } from '@/tools/oracle_fusion_sales/types'

const ID_FIELDS: Record<string, readonly string[]> = {
  account: ['PartyId', 'OwnerPartyId', 'ParentAccountPartyId', 'PrimaryContactPartyId'],
  contact: ['PartyId', 'AccountPartyId', 'OwnerPartyId'],
  lead: ['LeadId', 'CustomerId', 'OwnerId', 'PrimaryContactId'],
  opportunity: [
    'OptyId',
    'TargetPartyId',
    'OwnerResourcePartyId',
    'KeyContactId',
    'PrimaryOrganizationId',
    'SalesMethodId',
    'SalesStageId',
  ],
  activity: ['ActivityId', 'OwnerId', 'AccountId', 'OpportunityId', 'LeadId', 'PrimaryContactId'],
  resource: ['PartyId', 'ResourceProfileId'],
  opportunityContact: ['OptyConId', 'OptyId', 'PERPartyId', 'RelationshipId'],
  revenue: [
    'RevnId',
    'OptyId',
    'ProdGroupId',
    'InventoryItemId',
    'InventoryOrgId',
    'ResourcePartyId',
  ],
  teamMember: ['OptyResourceId', 'OptyId', 'ResourceId'],
  assignee: ['ActivityAssigneeId', 'ActivityId', 'AssigneeId'],
  activityContact: ['ActivityContactId', 'ActivityId', 'ContactId'],
}

function invalidRecord(): never {
  throw new OracleFusionProviderError('Oracle Fusion Sales returned invalid record data', 502)
}

/** Framework 8+ encodes reserved business-key characters before URL segment encoding. */
export function encodeOracleFusionSalesPublicNumber(value: string): string {
  return encodeOracleFusionPathSegment(encodeURIComponent(value))
}

/** Preserves losslessly parsed Oracle integers without Number conversion. */
export function readOracleFusionSalesId(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== value) return invalidRecord()
  const identifier = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 19 })
  if (identifier !== undefined) return identifier
  return invalidRecord()
}

/** Framework 9 represents high-precision numbers as strings; never round them through Number. */
function readDecimal(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (
    typeof value === 'string' &&
    value.trim() === value &&
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  )
    return value
  return invalidRecord()
}

export function readOracleFusionSalesObject(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return invalidRecord()
  return value
}

/** Projects documented fields only and validates the collection/destination of the self link. */
export function projectOracleFusionSalesRecord(
  value: unknown,
  entityName: string,
  credential: OracleFusionResolvedCredential,
  collectionPath: string,
  expectedKey?: string
): OracleFusionSalesRecord {
  const source = readOracleFusionSalesObject(value)
  const entity = ORACLE_FUSION_SALES_ENTITIES[entityName]
  const output: OracleFusionSalesRecord = {}
  for (const [field, property] of Object.entries(entity.outputProperties)) {
    if (field === 'resourceKey') continue
    const value = source[field]
    if (value == null) output[field] = null
    else if (ID_FIELDS[entityName].includes(field)) output[field] = readOracleFusionSalesId(value)
    else if (property.type === 'json') output[field] = readDecimal(value)
    else if (
      typeof value === property.type &&
      (typeof value !== 'number' || Number.isFinite(value))
    ) {
      output[field] = value as string | number | boolean
    } else return invalidRecord()
  }
  let resourceKey: string
  if (entity.publicKey) {
    const key = output[entity.publicKey]
    if (typeof key !== 'string' || !key) return invalidRecord()
    resourceKey = key
    validateOracleFusionSelfLink(value, credential.instanceUrl, {
      family: 'crm',
      relativePath: `${collectionPath}/${encodeOracleFusionSalesPublicNumber(key)}`,
    })
  } else {
    resourceKey = extractOracleFusionOpaqueKey(value, credential.instanceUrl, {
      family: 'crm',
      relativePath: collectionPath,
    })
    output.resourceKey = resourceKey
  }
  if (expectedKey !== undefined && resourceKey !== expectedKey) return invalidRecord()
  return output
}

/** Duplicate result fields are backed by the action's documented examples, not CRUD schemas. */
export function projectOracleFusionSalesDuplicates(value: unknown, entity: string) {
  const data = readOracleFusionSalesObject(value)
  if (!Array.isArray(data.result)) return invalidRecord()
  if (data.result.length > 1000) {
    throw new OracleFusionProviderError(
      'Oracle Fusion Sales returned more than 1,000 duplicate candidates; refine the matching fields',
      502
    )
  }
  const fields = Object.keys(getOracleFusionSalesDuplicateOutputs(entity))
  return data.result.map((item): OracleFusionSalesRecord => {
    const record = readOracleFusionSalesObject(item)
    return Object.fromEntries(
      fields.map((field) => {
        const value = record[field]
        if (value != null && typeof value !== 'string') return invalidRecord()
        return [field, value ?? null]
      })
    )
  })
}
