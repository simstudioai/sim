/**
 * Splits a comma or newline separated list of identifiers into a trimmed, de-duplicated array.
 * Used for Microsoft Graph parameters that take GUID collections (SKU IDs, service plan IDs).
 */
export function parseIdList(value: string | undefined | null): string[] {
  if (!value) return []
  const seen = new Set<string>()
  for (const raw of value.split(/[\n,]/)) {
    const trimmed = raw.trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen]
}

/**
 * Maps a Microsoft Graph `servicePlanInfo` collection to the documented subset of fields.
 * Shared by `licenseDetails` and `subscribedSku` responses, which both embed this type.
 */
export function mapServicePlans(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.map((plan: Record<string, unknown>) => ({
    servicePlanId: plan.servicePlanId ?? null,
    servicePlanName: plan.servicePlanName ?? null,
    provisioningStatus: plan.provisioningStatus ?? null,
    appliesTo: plan.appliesTo ?? null,
  }))
}

/**
 * Builds a Microsoft Graph collection URL, appending only the OData parameters that were
 * supplied. `select` is passed through verbatim; `filter` and `search` are URL-encoded.
 */
export function buildGraphCollectionUrl(
  path: string,
  options: {
    select?: string
    top?: number
    filter?: string
    search?: string
    orderby?: string
    count?: boolean
  }
): string {
  const queryParts: string[] = []
  if (options.select) queryParts.push(`$select=${options.select}`)
  if (options.top) queryParts.push(`$top=${options.top}`)
  if (options.filter) queryParts.push(`$filter=${encodeURIComponent(options.filter)}`)
  if (options.search) queryParts.push(`$search=${encodeURIComponent(options.search)}`)
  if (options.orderby) queryParts.push(`$orderby=${encodeURIComponent(options.orderby)}`)
  if (options.count) queryParts.push('$count=true')
  return queryParts.length > 0
    ? `https://graph.microsoft.com/v1.0/${path}?${queryParts.join('&')}`
    : `https://graph.microsoft.com/v1.0/${path}`
}

/** The `device` properties the Microsoft Entra ID tools project into their outputs. */
export const DEVICE_SELECT =
  'id,deviceId,displayName,operatingSystem,operatingSystemVersion,accountEnabled,isCompliant,isManaged,trustType,profileType,manufacturer,model,approximateLastSignInDateTime,registrationDateTime'

/**
 * Maps a Microsoft Graph `conditionalAccessPolicy` resource. The `conditions`, `grantControls`,
 * and `sessionControls` members are passed through as-is because their shape varies with the
 * controls a tenant has configured.
 */
export function mapConditionalAccessPolicy(
  policy: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: policy.id ?? null,
    displayName: policy.displayName ?? null,
    state: policy.state ?? null,
    templateId: policy.templateId ?? null,
    createdDateTime: policy.createdDateTime ?? null,
    modifiedDateTime: policy.modifiedDateTime ?? null,
    conditions: policy.conditions ?? null,
    grantControls: policy.grantControls ?? null,
    sessionControls: policy.sessionControls ?? null,
  }
}

/** Maps a Microsoft Graph `device` resource to the documented subset of fields. */
export function mapDevice(device: Record<string, unknown>): Record<string, unknown> {
  return {
    id: device.id ?? null,
    deviceId: device.deviceId ?? null,
    displayName: device.displayName ?? null,
    operatingSystem: device.operatingSystem ?? null,
    operatingSystemVersion: device.operatingSystemVersion ?? null,
    accountEnabled: device.accountEnabled ?? null,
    isCompliant: device.isCompliant ?? null,
    isManaged: device.isManaged ?? null,
    trustType: device.trustType ?? null,
    profileType: device.profileType ?? null,
    manufacturer: device.manufacturer ?? null,
    model: device.model ?? null,
    approximateLastSignInDateTime: device.approximateLastSignInDateTime ?? null,
    registrationDateTime: device.registrationDateTime ?? null,
  }
}
