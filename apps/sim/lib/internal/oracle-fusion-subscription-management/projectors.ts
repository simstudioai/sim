import { isPlainRecord } from '@sim/utils/object'
import type { OracleFusionResolvedCredential } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import { ORACLE_FUSION_SUBSCRIPTION_ENTITIES } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionRecord } from '@/tools/oracle_fusion_subscription_management/types'

function invalidRecord(): never {
  throw new OracleFusionProviderError('Oracle Fusion returned invalid subscription data', 502)
}

/** Framework 8+ encodes reserved business-key characters before URL segment encoding. */
export function encodeOracleFusionSubscriptionPublicKey(value: string): string {
  return encodeOracleFusionPathSegment(encodeURIComponent(value))
}

export function readOracleFusionSubscriptionObject(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return invalidRecord()
  return value
}

export function readOracleFusionSubscriptionId(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== value) return invalidRecord()
  const identifier = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 19 })
  if (identifier === undefined || BigInt(identifier) > 9223372036854775807n) {
    return invalidRecord()
  }
  return identifier
}

function readRuleId(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return invalidRecord()
  const text = String(value)
  if (!/^-?(?:0|[1-9]\d{0,18})$/.test(text)) return invalidRecord()
  const number = BigInt(text)
  if (number < -9223372036854775808n || number > 9223372036854775807n) return invalidRecord()
  return number.toString()
}

/** Preserve the number/string wire representation of framework 9 decimals. */
export function readOracleFusionSubscriptionDecimal(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (
    typeof value === 'string' &&
    value.trim() === value &&
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  ) {
    return value
  }
  return invalidRecord()
}

/** Project only documented fields and bind each result to its expected collection and key. */
export function projectOracleFusionSubscriptionRecord(
  value: unknown,
  entityName: string,
  credential: OracleFusionResolvedCredential,
  collectionPath: string,
  expectedKey?: string
): OracleFusionSubscriptionRecord {
  const source = readOracleFusionSubscriptionObject(value)
  const entity = ORACLE_FUSION_SUBSCRIPTION_ENTITIES[entityName]
  const output: OracleFusionSubscriptionRecord = {}
  for (const [field, property] of Object.entries(entity.outputProperties)) {
    if (field === 'resourceKey') continue
    const value = source[field]
    if (value == null) output[field] = null
    else if (entity.idFields.includes(field)) output[field] = readOracleFusionSubscriptionId(value)
    else if (entity.ruleIdFields.includes(field)) output[field] = readRuleId(value)
    else if (property.type === 'json') output[field] = readOracleFusionSubscriptionDecimal(value)
    else if (
      typeof value === property.type &&
      (typeof value !== 'number' || Number.isSafeInteger(value))
    ) {
      output[field] = value as string | number | boolean
    } else return invalidRecord()
  }
  let resourceKey: string
  if (entity.publicKey) {
    const key = output[entity.publicKey]
    if (typeof key !== 'string' || !key || key.trim() !== key) return invalidRecord()
    resourceKey = key
    validateOracleFusionSelfLink(value, credential.instanceUrl, {
      family: 'crm',
      relativePath: `${collectionPath}/${encodeOracleFusionSubscriptionPublicKey(key)}`,
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
