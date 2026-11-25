import { isPlainRecord } from '@sim/utils/object'
import { dryRunId } from '@/tools/dry-run'

/** A CRM write's `properties`, a JSON string parsed. */
export function parseHubSpotProperties(properties: unknown): unknown {
  if (typeof properties !== 'string') return properties
  try {
    return JSON.parse(properties)
  } catch {
    throw new Error('Invalid JSON format for properties. Please provide a valid JSON object.')
  }
}

/** Properties as HubSpot returns them: every scalar value a string. */
function asReturnedProperties(properties: unknown): unknown {
  if (!isPlainRecord(properties)) return properties
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [
      name,
      typeof value === 'number' || typeof value === 'boolean' ? String(value) : value,
    ])
  )
}

/**
 * A dry run's placeholder for the CRM record a create or update of `kind` returns, under `kind`
 * and `${kind}Id`: the properties the call writes, as the strings HubSpot returns (it returns the
 * rest of the record's too), with the record id the call names, or a placeholder id for one
 * HubSpot assigns or resolves from another id property.
 */
export function placeholderCrmRecord(kind: string, properties: unknown, id = dryRunId(kind)) {
  return {
    [kind]: {
      id,
      properties: asReturnedProperties(parseHubSpotProperties(properties)),
    },
    [`${kind}Id`]: id,
  }
}
