import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  IntuneDetectedApp,
  IntuneDeviceStatus,
  IntuneManagedDevice,
  IntunePageParams,
  IntunePolicy,
} from '@/tools/intune/types'
import type { ToolResponseContext } from '@/tools/types'

const INTUNE_BASE_URL = 'https://graph.microsoft.com/v1.0/deviceManagement/'
const MAX_PAGE_SIZE = 1000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export const INTUNE_AUTH_PARAMS = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Microsoft Intune OAuth access token',
  },
} as const

export const INTUNE_PAGE_PARAMS = {
  top: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Requested page size from 1 to 1000 (default: 100); ignored with nextLink',
  },
  nextLink: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'The nextLink from the previous response for this same operation and resource',
  },
} as const

/** Keeps resource identifiers in one Graph path segment, including after URL normalization. */
export function buildIntuneResourcePath(collection: string, id: string, child?: string): string {
  const trimmed = id.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[%/\\]/.test(trimmed)) {
    throw new Error('Enter a valid Intune resource ID, without path separators')
  }
  return `${collection}/${encodeURIComponent(trimmed)}${child ? `/${child}` : ''}`
}

/** Binds a continuation to the exact Graph collection before attaching OAuth credentials. */
export function buildIntuneCollectionUrl(
  path: string,
  params: Pick<IntunePageParams, 'top' | 'nextLink'> & { filter?: string }
): string {
  if (params.nextLink?.trim()) {
    const next = new URL(params.nextLink.trim())
    const expected = new URL(path, INTUNE_BASE_URL)
    if (
      next.origin !== expected.origin ||
      next.username ||
      next.password ||
      next.hash ||
      next.pathname !== expected.pathname
    ) {
      throw new Error(
        'Next Page URL must continue the same Microsoft Intune collection and resource'
      )
    }
    const nextTop = next.searchParams.get('$top')
    if (nextTop !== null) validatePageSize(Number(nextTop))
    return next.toString()
  }
  const url = new URL(path, INTUNE_BASE_URL)
  url.searchParams.set('$top', String(validatePageSize(params.top ?? 100)))
  if (path === 'managedDevices' && params.filter?.trim()) {
    url.searchParams.set('$filter', params.filter.trim())
  }
  return url.toString()
}

function validatePageSize(top: number): number {
  if (!Number.isInteger(top) || top < 1 || top > MAX_PAGE_SIZE) {
    throw new Error(`Page size must be an integer between 1 and ${MAX_PAGE_SIZE}`)
  }
  return top
}

/** Builds a fixed Microsoft Graph v1.0 URL for a single Intune resource. */
export function buildIntuneResourceUrl(path: string): string {
  return new URL(path, INTUNE_BASE_URL).toString()
}

/** Requires user-owned confirmation before an action that interrupts or retires a device. */
export function buildIntuneActionUrl(
  managedDeviceId: string,
  action: 'syncDevice' | 'rebootNow' | 'remoteLock' | 'retire',
  confirmAction?: unknown
): string {
  if (action !== 'syncDevice' && confirmAction !== true) {
    throw new Error('Confirm the device action before rebooting, locking, or retiring a device')
  }
  return buildIntuneResourceUrl(buildIntuneResourcePath('managedDevices', managedDeviceId, action))
}

/** Builds the Microsoft Graph JSON request headers. */
export function intuneHeaders(params: { accessToken: string }): Record<string, string> {
  return {
    Authorization: `Bearer ${params.accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

async function readIntuneResponse(
  response: Response,
  context?: ToolResponseContext
): Promise<Record<string, unknown>> {
  const data = toRecord(
    await readResponseJsonWithLimit(response, {
      maxBytes: MAX_RESPONSE_BYTES,
      label: 'Microsoft Intune response',
      signal: context?.signal,
    })
  )
  if (!response.ok || data.error) {
    const error = toRecord(data.error)
    throw new Error(
      toStringOrNull(error.message) ?? `Microsoft Intune request failed (${response.status})`
    )
  }
  return data
}

/** Reads one bounded Graph page and preserves its resource-bound continuation URL. */
export async function readIntunePage<T>(
  response: Response,
  path: string,
  map: (value: unknown) => T,
  context?: ToolResponseContext
): Promise<{ items: T[]; nextLink: string | null }> {
  const data = await readIntuneResponse(response, context)
  if (!Array.isArray(data.value)) throw new Error('Microsoft Intune returned an invalid collection')
  if (data.value.length > MAX_PAGE_SIZE) {
    throw new Error(`Microsoft Intune returned more than ${MAX_PAGE_SIZE} items in one page`)
  }
  const nextLink = toStringOrNull(data['@odata.nextLink'])
  return {
    items: data.value.map(map),
    nextLink: nextLink ? buildIntuneCollectionUrl(path, { nextLink }) : null,
  }
}

/** Accepts Graph entity responses and the value-wrapped examples in Intune's API reference. */
export async function readIntuneEntity<T>(
  response: Response,
  map: (value: unknown) => T,
  context?: ToolResponseContext
): Promise<T> {
  const data = await readIntuneResponse(response, context)
  return map(isRecordLike(data.value) ? data.value : data)
}

/** A 204 acknowledges the request; it does not establish that the device completed the action. */
export async function readIntuneActionResponse(
  response: Response,
  context?: ToolResponseContext
): Promise<{ accepted: boolean }> {
  if (response.status !== 204) {
    await readIntuneResponse(response, context)
    throw new Error(`Microsoft Intune returned unexpected action status ${response.status}`)
  }
  return { accepted: true }
}

function requireResourceId(value: unknown): string {
  const id = toStringOrNull(value)
  if (!id) throw new Error('Microsoft Intune returned a resource without an ID')
  return id
}

/** Projects documented ManagedDevice fields without exposing unrelated provider properties. */
export function mapIntuneManagedDevice(value: unknown): IntuneManagedDevice {
  const data = toRecord(value)
  return {
    id: requireResourceId(data.id),
    deviceName: toStringOrNull(data.deviceName),
    managedDeviceOwnerType: toStringOrNull(data.managedDeviceOwnerType),
    managementState: toStringOrNull(data.managementState),
    enrolledDateTime: toStringOrNull(data.enrolledDateTime),
    lastSyncDateTime: toStringOrNull(data.lastSyncDateTime),
    operatingSystem: toStringOrNull(data.operatingSystem),
    osVersion: toStringOrNull(data.osVersion),
    complianceState: toStringOrNull(data.complianceState),
    isEncrypted: toBooleanOrNull(data.isEncrypted),
    userId: toStringOrNull(data.userId),
    userPrincipalName: toStringOrNull(data.userPrincipalName),
    userDisplayName: toStringOrNull(data.userDisplayName),
    emailAddress: toStringOrNull(data.emailAddress),
    azureADDeviceId: toStringOrNull(data.azureADDeviceId),
    serialNumber: toStringOrNull(data.serialNumber),
    manufacturer: toStringOrNull(data.manufacturer),
    model: toStringOrNull(data.model),
    totalStorageSpaceInBytes: toNumberOrNull(data.totalStorageSpaceInBytes),
    freeStorageSpaceInBytes: toNumberOrNull(data.freeStorageSpaceInBytes),
  }
}

/** Projects documented DetectedApp fields without exposing unrelated provider properties. */
export function mapIntuneDetectedApp(value: unknown): IntuneDetectedApp {
  const data = toRecord(value)
  return {
    id: requireResourceId(data.id),
    displayName: toStringOrNull(data.displayName),
    version: toStringOrNull(data.version),
    sizeInByte: toNumberOrNull(data.sizeInByte),
    deviceCount: toNumberOrNull(data.deviceCount),
    publisher: toStringOrNull(data.publisher),
    platform: toStringOrNull(data.platform),
  }
}

/** Projects documented Policy fields without exposing unrelated provider properties. */
export function mapIntunePolicy(value: unknown): IntunePolicy {
  const data = toRecord(value)
  return {
    id: requireResourceId(data.id),
    displayName: toStringOrNull(data.displayName),
    description: toStringOrNull(data.description),
    createdDateTime: toStringOrNull(data.createdDateTime),
    lastModifiedDateTime: toStringOrNull(data.lastModifiedDateTime),
    version: toNumberOrNull(data.version),
  }
}

/** Projects documented DeviceStatus fields without exposing unrelated provider properties. */
export function mapIntuneDeviceStatus(value: unknown): IntuneDeviceStatus {
  const data = toRecord(value)
  return {
    id: requireResourceId(data.id),
    deviceDisplayName: toStringOrNull(data.deviceDisplayName),
    userName: toStringOrNull(data.userName),
    deviceModel: toStringOrNull(data.deviceModel),
    status: toStringOrNull(data.status),
    lastReportedDateTime: toStringOrNull(data.lastReportedDateTime),
    userPrincipalName: toStringOrNull(data.userPrincipalName),
    complianceGracePeriodExpirationDateTime: toStringOrNull(
      data.complianceGracePeriodExpirationDateTime
    ),
  }
}
