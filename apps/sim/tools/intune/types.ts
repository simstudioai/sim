import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

export interface IntuneManagedDevice {
  id: string
  deviceName: string | null
  managedDeviceOwnerType: string | null
  managementState: string | null
  enrolledDateTime: string | null
  lastSyncDateTime: string | null
  operatingSystem: string | null
  osVersion: string | null
  complianceState: string | null
  isEncrypted: boolean | null
  userId: string | null
  userPrincipalName: string | null
  userDisplayName: string | null
  emailAddress: string | null
  azureADDeviceId: string | null
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  totalStorageSpaceInBytes: number | null
  freeStorageSpaceInBytes: number | null
}

export interface IntuneDetectedApp {
  id: string
  displayName: string | null
  version: string | null
  sizeInByte: number | null
  deviceCount: number | null
  publisher: string | null
  platform: string | null
}

export interface IntunePolicy {
  id: string
  displayName: string | null
  description: string | null
  createdDateTime: string | null
  lastModifiedDateTime: string | null
  version: number | null
}

export interface IntuneDeviceStatus {
  id: string
  deviceDisplayName: string | null
  userName: string | null
  deviceModel: string | null
  status: string | null
  lastReportedDateTime: string | null
  userPrincipalName: string | null
  complianceGracePeriodExpirationDateTime: string | null
}

export interface IntunePageParams {
  accessToken: string
  top?: number
  nextLink?: string
}

export interface IntuneListDevicesParams extends IntunePageParams {
  filter?: string
}

export interface IntuneListDevicesResponse extends ToolResponse {
  output: {
    devices: IntuneManagedDevice[]
    nextLink: string | null
  }
}

export interface IntuneGetDeviceParams {
  accessToken: string
  managedDeviceId: string
}

export interface IntuneGetDeviceResponse extends ToolResponse {
  output: {
    device: IntuneManagedDevice
  }
}

export interface IntuneListDetectedAppsParams extends IntunePageParams {}

export interface IntuneListDetectedAppsResponse extends ToolResponse {
  output: {
    apps: IntuneDetectedApp[]
    nextLink: string | null
  }
}

export interface IntuneGetDetectedAppParams {
  accessToken: string
  detectedAppId: string
}

export interface IntuneGetDetectedAppResponse extends ToolResponse {
  output: {
    app: IntuneDetectedApp
  }
}

export interface IntuneListAppDevicesParams extends IntunePageParams {
  detectedAppId: string
}

export interface IntuneListAppDevicesResponse extends ToolResponse {
  output: {
    devices: IntuneManagedDevice[]
    nextLink: string | null
  }
}

export interface IntuneListCompliancePoliciesParams extends IntunePageParams {}

export interface IntuneListCompliancePoliciesResponse extends ToolResponse {
  output: {
    policies: IntunePolicy[]
    nextLink: string | null
  }
}

export interface IntuneGetCompliancePolicyParams {
  accessToken: string
  compliancePolicyId: string
}

export interface IntuneGetCompliancePolicyResponse extends ToolResponse {
  output: {
    policy: IntunePolicy
  }
}

export interface IntuneListCompliancePolicyDeviceStatusesParams extends IntunePageParams {
  compliancePolicyId: string
}

export interface IntuneListCompliancePolicyDeviceStatusesResponse extends ToolResponse {
  output: {
    deviceStatuses: IntuneDeviceStatus[]
    nextLink: string | null
  }
}

export interface IntuneListDeviceConfigurationsParams extends IntunePageParams {}

export interface IntuneListDeviceConfigurationsResponse extends ToolResponse {
  output: {
    configurations: IntunePolicy[]
    nextLink: string | null
  }
}

export interface IntuneGetDeviceConfigurationParams {
  accessToken: string
  configurationId: string
}

export interface IntuneGetDeviceConfigurationResponse extends ToolResponse {
  output: {
    configuration: IntunePolicy
  }
}

export interface IntuneSyncDeviceParams {
  accessToken: string
  managedDeviceId: string
}

export interface IntuneSyncDeviceResponse extends ToolResponse {
  output: {
    accepted: boolean
  }
}

export interface IntuneRebootDeviceParams {
  accessToken: string
  managedDeviceId: string
  confirmAction: boolean
}

export interface IntuneRebootDeviceResponse extends ToolResponse {
  output: {
    accepted: boolean
  }
}

export interface IntuneRemoteLockDeviceParams {
  accessToken: string
  managedDeviceId: string
  confirmAction: boolean
}

export interface IntuneRemoteLockDeviceResponse extends ToolResponse {
  output: {
    accepted: boolean
  }
}

export interface IntuneRetireDeviceParams {
  accessToken: string
  managedDeviceId: string
  confirmAction: boolean
}

export interface IntuneRetireDeviceResponse extends ToolResponse {
  output: {
    accepted: boolean
  }
}

export const INTUNE_MANAGED_DEVICE_PROPERTIES = {
  id: { type: 'string', description: 'Intune managed device ID' },
  deviceName: { type: 'string', description: 'Device name', optional: true },
  managedDeviceOwnerType: {
    type: 'string',
    description: 'Ownership: company, personal, or unknown',
    optional: true,
  },
  managementState: {
    type: 'string',
    description: 'Current device management state',
    optional: true,
  },
  enrolledDateTime: { type: 'string', description: 'Enrollment time', optional: true },
  lastSyncDateTime: { type: 'string', description: 'Last check-in time', optional: true },
  operatingSystem: { type: 'string', description: 'Operating system', optional: true },
  osVersion: { type: 'string', description: 'Operating system version', optional: true },
  complianceState: { type: 'string', description: 'Device compliance state', optional: true },
  isEncrypted: {
    type: 'boolean',
    description: 'Whether device storage is encrypted',
    optional: true,
  },
  userId: { type: 'string', description: 'Primary user ID', optional: true },
  userPrincipalName: { type: 'string', description: 'Primary user principal name', optional: true },
  userDisplayName: { type: 'string', description: 'Primary user display name', optional: true },
  emailAddress: { type: 'string', description: 'User email address', optional: true },
  azureADDeviceId: { type: 'string', description: 'Microsoft Entra device ID', optional: true },
  serialNumber: { type: 'string', description: 'Device serial number', optional: true },
  manufacturer: { type: 'string', description: 'Device manufacturer', optional: true },
  model: { type: 'string', description: 'Device model', optional: true },
  totalStorageSpaceInBytes: {
    type: 'number',
    description: 'Total storage capacity in bytes',
    optional: true,
  },
  freeStorageSpaceInBytes: {
    type: 'number',
    description: 'Available storage in bytes',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const INTUNE_DETECTED_APP_PROPERTIES = {
  id: { type: 'string', description: 'Detected application ID' },
  displayName: { type: 'string', description: 'Application display name', optional: true },
  version: { type: 'string', description: 'Application version', optional: true },
  sizeInByte: { type: 'number', description: 'Application size in bytes', optional: true },
  deviceCount: {
    type: 'number',
    description: 'Number of devices with this application',
    optional: true,
  },
  publisher: { type: 'string', description: 'Application publisher', optional: true },
  platform: { type: 'string', description: 'Application platform', optional: true },
} as const satisfies Record<string, ToolOutputProperty>

export const INTUNE_POLICY_PROPERTIES = {
  id: { type: 'string', description: 'Policy or configuration ID' },
  displayName: { type: 'string', description: 'Policy or configuration name', optional: true },
  description: {
    type: 'string',
    description: 'Administrator-provided description',
    optional: true,
  },
  createdDateTime: { type: 'string', description: 'Creation time', optional: true },
  lastModifiedDateTime: { type: 'string', description: 'Last modification time', optional: true },
  version: { type: 'number', description: 'Policy or configuration version', optional: true },
} as const satisfies Record<string, ToolOutputProperty>

export const INTUNE_DEVICE_STATUS_PROPERTIES = {
  id: { type: 'string', description: 'Device status record ID' },
  deviceDisplayName: { type: 'string', description: 'Device display name', optional: true },
  userName: { type: 'string', description: 'User name', optional: true },
  deviceModel: { type: 'string', description: 'Device model', optional: true },
  status: {
    type: 'string',
    description: 'Reported compliance status',
    optional: true,
  },
  lastReportedDateTime: { type: 'string', description: 'Last status report time', optional: true },
  userPrincipalName: { type: 'string', description: 'User principal name', optional: true },
  complianceGracePeriodExpirationDateTime: {
    type: 'string',
    description: 'Compliance grace period expiration',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const INTUNE_NEXT_LINK_OUTPUT = {
  type: 'string',
  description: 'Continuation URL for the next page; null when this is the final page',
  optional: true,
} as const
