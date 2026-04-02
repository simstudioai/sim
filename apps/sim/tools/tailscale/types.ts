import type { ToolResponse } from '@/tools/types'

export interface TailscaleBaseParams {
  apiKey: string
  tailnet: string
}

export interface TailscaleDeviceParams extends TailscaleBaseParams {
  deviceId: string
}

export interface TailscaleSetDeviceTagsParams extends TailscaleDeviceParams {
  tags: string
}

export interface TailscaleAuthorizeDeviceParams extends TailscaleDeviceParams {
  authorized: boolean
}

export interface TailscaleSetDeviceRoutesParams extends TailscaleDeviceParams {
  routes: string
}

export interface TailscaleCreateAuthKeyParams extends TailscaleBaseParams {
  reusable: boolean
  ephemeral: boolean
  preauthorized: boolean
  tags?: string
  description?: string
  expirySeconds?: number
}

export interface TailscaleDeviceOutput {
  id: string
  name: string
  hostname: string
  user: string
  os: string
  clientVersion: string
  addresses: string[]
  tags: string[]
  authorized: boolean
  blocksIncomingConnections: boolean
  lastSeen: string
  created: string
}

export interface TailscaleUserOutput {
  id: string
  displayName: string
  loginName: string
  profilePicURL: string
  role: string
  status: string
  type: string
  created: string
  lastSeen: string
  deviceCount: number
}

export interface TailscaleListDevicesResponse extends ToolResponse {
  output: {
    devices: TailscaleDeviceOutput[]
    count: number
  }
}

export interface TailscaleGetDeviceResponse extends ToolResponse {
  output: TailscaleDeviceOutput & {
    isExternal: boolean
    updateAvailable: boolean
    machineKey: string
    nodeKey: string
  }
}

export interface TailscaleUpdateDeviceKeyParams extends TailscaleDeviceParams {
  keyExpiryDisabled: boolean
}

export interface TailscaleUpdateDeviceKeyResponse extends ToolResponse {
  output: {
    success: boolean
    deviceId: string
    keyExpiryDisabled: boolean
  }
}

export interface TailscaleDeleteDeviceResponse extends ToolResponse {
  output: {
    success: boolean
    deviceId: string
  }
}

export interface TailscaleAuthorizeDeviceResponse extends ToolResponse {
  output: {
    success: boolean
    deviceId: string
    authorized: boolean
  }
}

export interface TailscaleSetDeviceTagsResponse extends ToolResponse {
  output: {
    success: boolean
    deviceId: string
    tags: string[]
  }
}

export interface TailscaleGetDeviceRoutesResponse extends ToolResponse {
  output: {
    advertisedRoutes: string[]
    enabledRoutes: string[]
  }
}

export interface TailscaleSetDeviceRoutesResponse extends ToolResponse {
  output: {
    advertisedRoutes: string[]
    enabledRoutes: string[]
  }
}

export interface TailscaleListDnsNameserversResponse extends ToolResponse {
  output: {
    dns: string[]
    magicDNS: boolean
  }
}

export interface TailscaleListUsersResponse extends ToolResponse {
  output: {
    users: TailscaleUserOutput[]
    count: number
  }
}

export interface TailscaleCreateAuthKeyResponse extends ToolResponse {
  output: {
    id: string
    key: string
    description: string
    created: string
    expires: string
    revoked: string
    capabilities: {
      reusable: boolean
      ephemeral: boolean
      preauthorized: boolean
      tags: string[]
    }
  }
}
