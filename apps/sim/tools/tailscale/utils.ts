import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  TailscaleDevice,
  TailscaleDeviceOutput,
  TailscaleKey,
  TailscaleKeyOutput,
  TailscaleUser,
  TailscaleUserOutput,
} from '@/tools/tailscale/types'

export async function assertTailscaleResponse(response: Response): Promise<void> {
  if (response.ok) return
  const data: unknown = await response.json().catch(() => null)
  throw new Error(
    toStringOrNull(toRecord(data).message) ?? `Tailscale API request failed (${response.status})`
  )
}

export function parseTailscaleList(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    const items: unknown = JSON.parse(trimmed)
    if (!Array.isArray(items) || !items.every((item) => typeof item === 'string')) {
      throw new Error('Expected a JSON array of strings or a comma-separated list')
    }
    const values = items.map((item) => item.trim()).filter(Boolean)
    if (items.length && !values.length) throw new Error('Use [] to explicitly clear a list')
    return values
  }
  const values = trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!values.length) throw new Error('Use [] to explicitly clear a list')
  return values
}

export function mapTailscaleDevice(data: TailscaleDevice): TailscaleDeviceOutput {
  return {
    addresses: data.addresses ?? [],
    id: data.id ?? null,
    nodeId: data.nodeId ?? null,
    user: data.user ?? null,
    name: data.name ?? null,
    hostname: data.hostname ?? null,
    clientVersion: data.clientVersion ?? null,
    updateAvailable: data.updateAvailable ?? null,
    os: data.os ?? null,
    created: data.created ?? null,
    connectedToControl: data.connectedToControl ?? null,
    lastSeen: data.lastSeen ?? null,
    keyExpiryDisabled: data.keyExpiryDisabled ?? null,
    expires: data.expires ?? null,
    authorized: data.authorized ?? null,
    isExternal: data.isExternal ?? null,
    multipleConnections: data.multipleConnections ?? null,
    machineKey: data.machineKey ?? null,
    nodeKey: data.nodeKey ?? null,
    blocksIncomingConnections: data.blocksIncomingConnections ?? null,
    enabledRoutes: data.enabledRoutes ?? [],
    advertisedRoutes: data.advertisedRoutes ?? [],
    clientConnectivity: data.clientConnectivity ?? null,
    tags: data.tags ?? [],
    tailnetLockError: data.tailnetLockError ?? null,
    tailnetLockKey: data.tailnetLockKey ?? null,
    sshEnabled: data.sshEnabled ?? null,
    postureIdentity: data.postureIdentity ?? null,
    postureStatus: data.postureStatus ?? null,
    isEphemeral: data.isEphemeral ?? null,
    distro: data.distro ?? null,
  }
}

export function mapTailscaleUser(data: TailscaleUser): TailscaleUserOutput {
  return {
    id: data.id ?? null,
    displayName: data.displayName ?? null,
    loginName: data.loginName ?? null,
    tailnetId: data.tailnetId ?? null,
    created: data.created ?? null,
    type: data.type ?? null,
    role: data.role ?? null,
    status: data.status ?? null,
    deviceCount: data.deviceCount ?? null,
    lastSeen: data.lastSeen ?? null,
    currentlyConnected: data.currentlyConnected ?? null,
    profilePicURL: data.profilePicUrl ?? null,
  }
}

export function mapTailscaleKey(data: TailscaleKey): TailscaleKeyOutput {
  const capabilities = data.capabilities?.devices?.create
  return {
    id: data.id ?? null,
    keyType: data.keyType ?? null,
    expirySeconds: data.expirySeconds ?? null,
    created: data.created ?? null,
    updated: data.updated ?? null,
    expires: data.expires ?? null,
    revoked: data.revoked ?? null,
    capabilities: {
      reusable: capabilities?.reusable ?? false,
      ephemeral: capabilities?.ephemeral ?? false,
      preauthorized: capabilities?.preauthorized ?? false,
      tags: capabilities?.tags ?? [],
    },
    scopes: data.scopes ?? [],
    tags: data.tags ?? [],
    description: data.description ?? null,
    invalid: data.invalid ?? null,
    userId: data.userId ?? null,
    audience: data.audience ?? null,
    issuer: data.issuer ?? null,
    subject: data.subject ?? null,
    customClaimRules: data.customClaimRules ?? null,
  }
}
