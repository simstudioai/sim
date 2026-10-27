import type { ToolResponse } from '@/tools/types'

interface TailscaleCredentials {
  apiKey: string
}
export interface TailscaleBaseParams extends TailscaleCredentials {
  tailnet: string
}
export interface TailscaleDeviceParams extends TailscaleCredentials {
  deviceId: string
}
export interface TailscaleUserParams extends TailscaleCredentials {
  userId: string
}
export interface TailscaleAuthKeyParams extends TailscaleBaseParams {
  keyId: string
}
export interface TailscaleListDevicesParams extends TailscaleBaseParams {
  fields?: string
  filters?: string
}
export interface TailscaleGetDeviceParams extends TailscaleDeviceParams {
  fields?: string
}
export interface TailscaleListUsersParams extends TailscaleBaseParams {
  userType?: string
  role?: string
}
export interface TailscaleListAuthKeysParams extends TailscaleBaseParams {
  all?: boolean
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
export interface TailscaleUpdateDeviceKeyParams extends TailscaleDeviceParams {
  keyExpiryDisabled: boolean
}
export interface TailscaleCreateAuthKeyParams extends TailscaleBaseParams {
  reusable?: boolean
  ephemeral?: boolean
  preauthorized?: boolean
  tags?: string
  description?: string
  expirySeconds?: number
}
export interface TailscaleGetAclParams extends TailscaleBaseParams {
  details?: boolean
}
export interface TailscaleSetAclParams extends TailscaleBaseParams {
  acl: string
  ifMatch?: string
}
export interface TailscaleSetDnsNameserversParams extends TailscaleBaseParams {
  dns: string
}
export interface TailscaleSetDnsPreferencesParams extends TailscaleBaseParams {
  magicDNS: boolean
}
export interface TailscaleSetDnsSearchpathsParams extends TailscaleBaseParams {
  searchPaths: string
}
export interface TailscaleSetDeviceNameParams extends TailscaleDeviceParams {
  name?: string
}
export interface TailscaleSetUserRoleParams extends TailscaleUserParams {
  role: string
}
export interface TailscaleDeviceAttributeParams extends TailscaleDeviceParams {
  attributeKey: string
}
export interface TailscaleSetDeviceAttributeParams extends TailscaleDeviceAttributeParams {
  attributeValue: string
  expiry?: string
  comment?: string
}
export interface TailscaleSetSplitDnsParams extends TailscaleBaseParams {
  splitDns: string
}
export interface TailscaleValidateAclParams extends TailscaleBaseParams {
  acl: string
}
export interface TailscaleDevice {
  addresses?: string[]
  id?: string
  nodeId?: string
  user?: string
  name?: string
  hostname?: string
  clientVersion?: string
  updateAvailable?: boolean
  os?: string
  created?: string
  connectedToControl?: boolean
  lastSeen?: string
  keyExpiryDisabled?: boolean
  expires?: string
  authorized?: boolean
  isExternal?: boolean
  multipleConnections?: boolean
  machineKey?: string
  nodeKey?: string
  blocksIncomingConnections?: boolean
  enabledRoutes?: string[]
  advertisedRoutes?: string[]
  clientConnectivity?: {
    endpoints?: string[]
    mappingVariesByDestIP?: boolean
    latency?: Record<string, { preferred?: boolean; latencyMs?: number }>
    clientSupports?: {
      hairPinning?: boolean | null
      ipv6?: boolean | null
      pcp?: boolean | null
      pmp?: boolean | null
      udp?: boolean | null
      upnp?: boolean | null
    }
  }
  tags?: string[]
  tailnetLockError?: string
  tailnetLockKey?: string
  sshEnabled?: boolean
  postureIdentity?: { serialNumbers?: string[]; disabled?: boolean }
  postureStatus?: { passing?: boolean; impacting?: boolean; failingAssertions?: string[] }
  isEphemeral?: boolean
  distro?: { name?: string; version?: string; codeName?: string }
}
export interface TailscaleDeviceOutput {
  addresses: string[]
  id: string | null
  nodeId: string | null
  user: string | null
  name: string | null
  hostname: string | null
  clientVersion: string | null
  updateAvailable: boolean | null
  os: string | null
  created: string | null
  connectedToControl: boolean | null
  lastSeen: string | null
  keyExpiryDisabled: boolean | null
  expires: string | null
  authorized: boolean | null
  isExternal: boolean | null
  multipleConnections: boolean | null
  machineKey: string | null
  nodeKey: string | null
  blocksIncomingConnections: boolean | null
  enabledRoutes: string[]
  advertisedRoutes: string[]
  clientConnectivity: {
    endpoints?: string[]
    mappingVariesByDestIP?: boolean
    latency?: Record<string, { preferred?: boolean; latencyMs?: number }>
    clientSupports?: {
      hairPinning?: boolean | null
      ipv6?: boolean | null
      pcp?: boolean | null
      pmp?: boolean | null
      udp?: boolean | null
      upnp?: boolean | null
    }
  } | null
  tags: string[]
  tailnetLockError: string | null
  tailnetLockKey: string | null
  sshEnabled: boolean | null
  postureIdentity: { serialNumbers?: string[]; disabled?: boolean } | null
  postureStatus: { passing?: boolean; impacting?: boolean; failingAssertions?: string[] } | null
  isEphemeral: boolean | null
  distro: { name?: string; version?: string; codeName?: string } | null
}
export interface TailscaleUser {
  id?: string
  displayName?: string
  loginName?: string
  profilePicUrl?: string
  tailnetId?: string
  created?: string
  type?: string
  role?: string
  status?: string
  deviceCount?: number
  lastSeen?: string
  currentlyConnected?: boolean
}
export interface TailscaleUserOutput {
  id: string | null
  displayName: string | null
  loginName: string | null
  tailnetId: string | null
  created: string | null
  type: string | null
  role: string | null
  status: string | null
  deviceCount: number | null
  lastSeen: string | null
  currentlyConnected: boolean | null
  profilePicURL: string | null
}
export interface TailscaleKey {
  id?: string
  key?: string
  keyType?: string
  expirySeconds?: number
  created?: string
  updated?: string
  expires?: string
  revoked?: string
  capabilities?: {
    devices?: {
      create?: { reusable?: boolean; ephemeral?: boolean; preauthorized?: boolean; tags?: string[] }
    }
  }
  scopes?: string[]
  tags?: string[]
  description?: string
  invalid?: boolean
  userId?: string
  audience?: string
  issuer?: string
  subject?: string
  customClaimRules?: Record<string, string>
}
export interface TailscaleKeyOutput {
  id: string | null
  keyType: string | null
  expirySeconds: number | null
  created: string | null
  updated: string | null
  expires: string | null
  revoked: string | null
  capabilities: {
    reusable?: boolean
    ephemeral?: boolean
    preauthorized?: boolean
    tags?: string[]
  }
  scopes: string[]
  tags: string[]
  description: string | null
  invalid: boolean | null
  userId: string | null
  audience: string | null
  issuer: string | null
  subject: string | null
  customClaimRules: Record<string, string> | null
}
export interface TailscaleListDevicesResponse extends ToolResponse {
  output: { devices: TailscaleDeviceOutput[]; count: number }
}
export interface TailscaleListUsersResponse extends ToolResponse {
  output: { users: TailscaleUserOutput[]; count: number }
}
export interface TailscaleListAuthKeysResponse extends ToolResponse {
  output: { keys: TailscaleKeyOutput[]; count: number }
}
export interface TailscaleGetDeviceResponse extends ToolResponse {
  output: TailscaleDeviceOutput
}
export interface TailscaleGetUserResponse extends ToolResponse {
  output: TailscaleUserOutput
}
export interface TailscaleGetAuthKeyResponse extends ToolResponse {
  output: TailscaleKeyOutput
}
export interface TailscaleDeleteDeviceResponse extends ToolResponse {
  output: { success: boolean; deviceId: string }
}
export interface TailscaleAuthorizeDeviceResponse extends ToolResponse {
  output: { success: boolean; deviceId: string; authorized: boolean }
}
export interface TailscaleUpdateDeviceKeyResponse extends ToolResponse {
  output: { success: boolean; deviceId: string; keyExpiryDisabled: boolean }
}
export interface TailscaleExpireDeviceKeyResponse extends ToolResponse {
  output: { success: boolean; deviceId: string }
}
export interface TailscaleSetDeviceTagsResponse extends ToolResponse {
  output: { success: boolean; deviceId: string; tags: string[] }
}
export interface TailscaleSetDeviceNameResponse extends ToolResponse {
  output: { success: boolean; deviceId: string; name: string }
}
export interface TailscaleSuspendUserResponse extends ToolResponse {
  output: { success: boolean; userId: string }
}
export interface TailscaleRestoreUserResponse extends ToolResponse {
  output: { success: boolean; userId: string }
}
export interface TailscaleApproveUserResponse extends ToolResponse {
  output: { success: boolean; userId: string }
}
export interface TailscaleDeleteUserResponse extends ToolResponse {
  output: { success: boolean; userId: string }
}
export interface TailscaleSetUserRoleResponse extends ToolResponse {
  output: { success: boolean; userId: string; role: string }
}
export interface TailscaleDeleteAuthKeyResponse extends ToolResponse {
  output: { success: boolean; keyId: string }
}
export interface TailscaleDeleteDeviceAttributeResponse extends ToolResponse {
  output: { success: boolean; deviceId: string; attributeKey: string }
}
export interface TailscaleGetDeviceRoutesResponse extends ToolResponse {
  output: { advertisedRoutes: string[]; enabledRoutes: string[] }
}
export interface TailscaleSetDeviceRoutesResponse extends ToolResponse {
  output: { advertisedRoutes: string[]; enabledRoutes: string[] }
}
export interface TailscaleListDnsNameserversResponse extends ToolResponse {
  output: { dns: string[] }
}
export interface TailscaleSetDnsNameserversResponse extends ToolResponse {
  output: { dns: string[]; magicDNS: boolean }
}
export interface TailscaleGetDnsPreferencesResponse extends ToolResponse {
  output: { magicDNS: boolean }
}
export interface TailscaleSetDnsPreferencesResponse extends ToolResponse {
  output: { magicDNS: boolean }
}
export interface TailscaleGetDnsSearchpathsResponse extends ToolResponse {
  output: { searchPaths: string[] }
}
export interface TailscaleSetDnsSearchpathsResponse extends ToolResponse {
  output: { searchPaths: string[] }
}
export interface TailscaleGetDeviceAttributesResponse extends ToolResponse {
  output: {
    attributes: Record<string, string | number | boolean>
    expiries: Record<string, string>
  }
}
export interface TailscaleSetDeviceAttributeResponse extends ToolResponse {
  output: {
    attributes: Record<string, string | number | boolean>
    expiries: Record<string, string>
  }
}
export interface TailscaleCreateAuthKeyResponse extends ToolResponse {
  output: TailscaleKeyOutput & { key: string | null }
}
export interface TailscaleGetAclResponse extends ToolResponse {
  output: { acl: string; etag: string; warnings: string[]; errors: string[] }
}
export interface TailscaleSetAclResponse extends ToolResponse {
  output: { acl: string; etag: string }
}
export interface TailscaleGetSplitDnsResponse extends ToolResponse {
  output: { splitDns: Record<string, string[] | null> }
}
export interface TailscaleSetSplitDnsResponse extends ToolResponse {
  output: { splitDns: Record<string, string[] | null> }
}
export interface TailscaleUpdateSplitDnsResponse extends ToolResponse {
  output: { splitDns: Record<string, string[] | null> }
}
export interface TailscaleValidateAclResponse extends ToolResponse {
  output: {
    valid: boolean
    message: string | null
    results: { user: string | null; errors: string[]; warnings: string[] }[]
  }
}
export interface TailscaleTailnetSettings {
  aclsExternallyManagedOn?: boolean | null
  aclsExternalLink?: string
  adminConsoleSessionTimeoutMinutes?: number
  devicesApprovalOn?: boolean | null
  devicesAutoUpdatesOn?: boolean | null
  devicesKeyDurationDays?: number
  usersApprovalOn?: boolean | null
  usersRoleAllowedToJoinExternalTailnets?: string
  networkFlowLoggingOn?: boolean | null
  regionalRoutingOn?: boolean | null
  routeSelection?: string
  postureIdentityCollectionOn?: boolean | null
  httpsEnabled?: boolean | null
}
export interface TailscaleGetTailnetSettingsResponse extends ToolResponse {
  output: {
    settings: {
      aclsExternallyManagedOn: boolean | null
      aclsExternalLink: string | null
      adminConsoleSessionTimeoutMinutes: number | null
      devicesApprovalOn: boolean | null
      devicesAutoUpdatesOn: boolean | null
      devicesKeyDurationDays: number | null
      usersApprovalOn: boolean | null
      usersRoleAllowedToJoinExternalTailnets: string | null
      networkFlowLoggingOn: boolean | null
      regionalRoutingOn: boolean | null
      routeSelection: string | null
      postureIdentityCollectionOn: boolean | null
      httpsEnabled: boolean | null
    }
  }
}
export interface TailscaleUpdateTailnetSettingsParams extends TailscaleBaseParams {
  settings: string
}
export interface TailscaleUpdateTailnetSettingsResponse extends ToolResponse {
  output: {
    settings: {
      aclsExternallyManagedOn: boolean | null
      aclsExternalLink: string | null
      adminConsoleSessionTimeoutMinutes: number | null
      devicesApprovalOn: boolean | null
      devicesAutoUpdatesOn: boolean | null
      devicesKeyDurationDays: number | null
      usersApprovalOn: boolean | null
      usersRoleAllowedToJoinExternalTailnets: string | null
      networkFlowLoggingOn: boolean | null
      regionalRoutingOn: boolean | null
      routeSelection: string | null
      postureIdentityCollectionOn: boolean | null
      httpsEnabled: boolean | null
    }
  }
}
export interface TailscaleDnsConfiguration {
  nameservers?: { address?: string; useWithExitNode?: boolean }[]
  splitDNS?: Record<string, { address?: string; useWithExitNode?: boolean }[] | null>
  searchPaths?: string[]
  preferences?: { overrideLocalDNS?: boolean; magicDNS?: boolean }
}
export interface TailscaleGetDnsConfigurationResponse extends ToolResponse {
  output: {
    dnsConfiguration: {
      nameservers: { address?: string; useWithExitNode?: boolean }[]
      splitDNS: Record<string, { address?: string; useWithExitNode?: boolean }[] | null> | null
      searchPaths: string[]
      preferences: { overrideLocalDNS?: boolean; magicDNS?: boolean } | null
    }
  }
}
export interface TailscaleSetDnsConfigurationParams extends TailscaleBaseParams {
  dnsConfiguration: string
}
export interface TailscaleSetDnsConfigurationResponse extends ToolResponse {
  output: {
    dnsConfiguration: {
      nameservers: { address?: string; useWithExitNode?: boolean }[]
      splitDNS: Record<string, { address?: string; useWithExitNode?: boolean }[] | null> | null
      searchPaths: string[]
      preferences: { overrideLocalDNS?: boolean; magicDNS?: boolean } | null
    }
  }
}
