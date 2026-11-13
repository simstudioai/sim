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
  managedDeviceName: string | null
  managementAgent: string | null
  deviceEnrollmentType: string | null
  enrollmentProfileName: string | null
  deviceRegistrationState: string | null
  deviceCategoryDisplayName: string | null
  jailBroken: string | null
  isSupervised: boolean | null
  azureADRegistered: boolean | null
  complianceGracePeriodExpirationDateTime: string | null
  managementCertificateExpirationDate: string | null
  partnerReportedThreatState: string | null
  exchangeAccessState: string | null
  exchangeAccessStateReason: string | null
  exchangeLastSuccessfulSyncDateTime: string | null
  easActivated: boolean | null
  androidSecurityPatchLevel: string | null
  imei: string | null
  meid: string | null
  phoneNumber: string | null
  subscriberCarrier: string | null
  wiFiMacAddress: string | null
  deviceActionResults: IntuneDeviceActionResult[]
}

export interface IntuneDeviceActionResult {
  actionName: string | null
  actionState: string | null
  startDateTime: string | null
  lastUpdatedDateTime: string | null
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
  odataType: string | null
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
  deviceName: { type: 'string', description: 'Device name', nullable: true },
  managedDeviceOwnerType: {
    type: 'string',
    description: 'Ownership: company, personal, or unknown',
    nullable: true,
  },
  managementState: {
    type: 'string',
    description:
      'Device management state; not part of the Graph v1.0 managedDevice resource, so usually null',
    nullable: true,
  },
  enrolledDateTime: { type: 'string', description: 'Enrollment time', nullable: true },
  lastSyncDateTime: { type: 'string', description: 'Last check-in time', nullable: true },
  operatingSystem: { type: 'string', description: 'Operating system', nullable: true },
  osVersion: { type: 'string', description: 'Operating system version', nullable: true },
  complianceState: { type: 'string', description: 'Device compliance state', nullable: true },
  isEncrypted: {
    type: 'boolean',
    description: 'Whether device storage is encrypted',
    nullable: true,
  },
  userId: { type: 'string', description: 'Primary user ID', nullable: true },
  userPrincipalName: { type: 'string', description: 'Primary user principal name', nullable: true },
  userDisplayName: { type: 'string', description: 'Primary user display name', nullable: true },
  emailAddress: { type: 'string', description: 'User email address', nullable: true },
  azureADDeviceId: { type: 'string', description: 'Microsoft Entra device ID', nullable: true },
  serialNumber: { type: 'string', description: 'Device serial number', nullable: true },
  manufacturer: { type: 'string', description: 'Device manufacturer', nullable: true },
  model: { type: 'string', description: 'Device model', nullable: true },
  totalStorageSpaceInBytes: {
    type: 'number',
    description: 'Total storage capacity in bytes',
    nullable: true,
  },
  freeStorageSpaceInBytes: {
    type: 'number',
    description: 'Available storage in bytes',
    nullable: true,
  },
  managedDeviceName: {
    type: 'string',
    description: 'Intune-generated or administrator-assigned device name',
    nullable: true,
  },
  managementAgent: {
    type: 'string',
    description: 'Management channel, such as mdm, eas, easMdm, or configurationManagerClient',
    nullable: true,
  },
  deviceEnrollmentType: {
    type: 'string',
    description: 'Enrollment type, such as userEnrollment or windowsAzureADJoin',
    nullable: true,
  },
  enrollmentProfileName: {
    type: 'string',
    description: 'Assigned enrollment profile name; empty when none was assigned',
    nullable: true,
  },
  deviceRegistrationState: {
    type: 'string',
    description: 'Registration state, such as registered, notRegistered, or revoked',
    nullable: true,
  },
  deviceCategoryDisplayName: {
    type: 'string',
    description: 'Device category display name',
    nullable: true,
  },
  jailBroken: {
    type: 'string',
    description: 'Whether the device is jailbroken or rooted, as reported by Intune',
    nullable: true,
  },
  isSupervised: { type: 'boolean', description: 'Device supervised status', nullable: true },
  azureADRegistered: {
    type: 'boolean',
    description: 'Whether the device is Microsoft Entra registered',
    nullable: true,
  },
  complianceGracePeriodExpirationDateTime: {
    type: 'string',
    description: 'When the device compliance grace period expires',
    nullable: true,
  },
  managementCertificateExpirationDate: {
    type: 'string',
    description: 'Device management certificate expiration date',
    nullable: true,
  },
  partnerReportedThreatState: {
    type: 'string',
    description: 'Mobile Threat Defense partner threat state, such as secured or highSeverity',
    nullable: true,
  },
  exchangeAccessState: {
    type: 'string',
    description: 'Exchange access state: none, unknown, allowed, blocked, or quarantined',
    nullable: true,
  },
  exchangeAccessStateReason: {
    type: 'string',
    description: 'Reason for the Exchange access state',
    nullable: true,
  },
  exchangeLastSuccessfulSyncDateTime: {
    type: 'string',
    description: 'Last time the device contacted Exchange',
    nullable: true,
  },
  easActivated: {
    type: 'boolean',
    description: 'Whether Exchange ActiveSync is activated',
    nullable: true,
  },
  androidSecurityPatchLevel: {
    type: 'string',
    description: 'Android security patch level',
    nullable: true,
  },
  imei: { type: 'string', description: 'Device IMEI', nullable: true },
  meid: { type: 'string', description: 'Device MEID', nullable: true },
  phoneNumber: { type: 'string', description: 'Device phone number', nullable: true },
  subscriberCarrier: { type: 'string', description: 'Subscriber carrier', nullable: true },
  wiFiMacAddress: { type: 'string', description: 'Wi-Fi MAC address', nullable: true },
  deviceActionResults: {
    type: 'array',
    description: 'Status of remote actions requested on the device, such as rebootNow or retire',
    items: {
      type: 'object',
      properties: {
        actionName: { type: 'string', description: 'Action name', nullable: true },
        actionState: {
          type: 'string',
          description: 'Action state, such as pending, done, failed, or notSupported',
          nullable: true,
        },
        startDateTime: { type: 'string', description: 'Action start time', nullable: true },
        lastUpdatedDateTime: {
          type: 'string',
          description: 'Last action state update time',
          nullable: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const INTUNE_DETECTED_APP_PROPERTIES = {
  id: { type: 'string', description: 'Detected application ID' },
  displayName: { type: 'string', description: 'Application display name', nullable: true },
  version: { type: 'string', description: 'Application version', nullable: true },
  sizeInByte: { type: 'number', description: 'Application size in bytes', nullable: true },
  deviceCount: {
    type: 'number',
    description: 'Number of devices with this application',
    nullable: true,
  },
  publisher: { type: 'string', description: 'Application publisher', nullable: true },
  platform: { type: 'string', description: 'Application platform', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const INTUNE_POLICY_PROPERTIES = {
  id: { type: 'string', description: 'Policy or configuration ID' },
  displayName: { type: 'string', description: 'Policy or configuration name', nullable: true },
  description: {
    type: 'string',
    description: 'Administrator-provided description',
    nullable: true,
  },
  createdDateTime: { type: 'string', description: 'Creation time', nullable: true },
  lastModifiedDateTime: { type: 'string', description: 'Last modification time', nullable: true },
  version: { type: 'number', description: 'Policy or configuration version', nullable: true },
  odataType: {
    type: 'string',
    description:
      'Graph @odata.type naming the platform-specific policy type, such as #microsoft.graph.windows10CompliancePolicy',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const INTUNE_DEVICE_STATUS_PROPERTIES = {
  id: { type: 'string', description: 'Device status record ID' },
  deviceDisplayName: { type: 'string', description: 'Device display name', nullable: true },
  userName: { type: 'string', description: 'User name', nullable: true },
  deviceModel: { type: 'string', description: 'Device model', nullable: true },
  status: {
    type: 'string',
    description: 'Reported compliance status',
    nullable: true,
  },
  lastReportedDateTime: { type: 'string', description: 'Last status report time', nullable: true },
  userPrincipalName: { type: 'string', description: 'User principal name', nullable: true },
  complianceGracePeriodExpirationDateTime: {
    type: 'string',
    description: 'Compliance grace period expiration',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const INTUNE_NEXT_LINK_OUTPUT = {
  type: 'string',
  description: 'Continuation URL for the next page; null when this is the final page',
  nullable: true,
} as const
