import type { OutputProperty, ToolResponse } from '@/tools/types'

interface MicrosoftAdBaseParams {
  accessToken: string
}

export interface MicrosoftAdListUsersParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  search?: string
  nextLink?: string
}

export interface MicrosoftAdGetUserParams extends MicrosoftAdBaseParams {
  userId: string
}

export interface MicrosoftAdCreateUserParams extends MicrosoftAdBaseParams {
  displayName: string
  mailNickname: string
  userPrincipalName: string
  password: string
  accountEnabled: boolean
  givenName?: string
  surname?: string
  jobTitle?: string
  department?: string
  officeLocation?: string
  mobilePhone?: string
}

export interface MicrosoftAdUpdateUserParams extends MicrosoftAdBaseParams {
  userId: string
  displayName?: string
  givenName?: string
  surname?: string
  jobTitle?: string
  department?: string
  officeLocation?: string
  mobilePhone?: string
  accountEnabled?: boolean
}

export interface MicrosoftAdDeleteUserParams extends MicrosoftAdBaseParams {
  userId: string
}

export interface MicrosoftAdListGroupsParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  search?: string
  nextLink?: string
}

export interface MicrosoftAdGetGroupParams extends MicrosoftAdBaseParams {
  groupId: string
}

export interface MicrosoftAdCreateGroupParams extends MicrosoftAdBaseParams {
  displayName: string
  mailNickname: string
  description?: string
  mailEnabled: boolean
  securityEnabled: boolean
  groupTypes?: string
  visibility?: string
}

export interface MicrosoftAdUpdateGroupParams extends MicrosoftAdBaseParams {
  groupId: string
  displayName?: string
  description?: string
  mailNickname?: string
  visibility?: string
}

export interface MicrosoftAdDeleteGroupParams extends MicrosoftAdBaseParams {
  groupId: string
}

export interface MicrosoftAdListGroupMembersParams extends MicrosoftAdBaseParams {
  groupId?: string
  top?: number
  nextLink?: string
}

export interface MicrosoftAdAddGroupMemberParams extends MicrosoftAdBaseParams {
  groupId: string
  memberId: string
}

export interface MicrosoftAdRemoveGroupMemberParams extends MicrosoftAdBaseParams {
  groupId: string
  memberId: string
}

export interface MicrosoftAdAssignLicenseParams extends MicrosoftAdBaseParams {
  userId: string
  addSkuIds?: string
  removeSkuIds?: string
  disabledPlanIds?: string
}

export interface MicrosoftAdListUserLicensesParams extends MicrosoftAdBaseParams {
  userId: string
}

export type MicrosoftAdListSubscribedSkusParams = MicrosoftAdBaseParams

export interface MicrosoftAdRevokeSignInSessionsParams extends MicrosoftAdBaseParams {
  userId: string
}

export interface MicrosoftAdSetPasswordParams extends MicrosoftAdBaseParams {
  userId: string
  password: string
  forceChangePasswordNextSignIn?: boolean
  forceChangePasswordNextSignInWithMfa?: boolean
}

export interface MicrosoftAdResetPasswordParams extends MicrosoftAdBaseParams {
  userId: string
  newPassword?: string
}

export interface MicrosoftAdListAuthenticationMethodsParams extends MicrosoftAdBaseParams {
  userId: string
}

export interface MicrosoftAdListSignInsParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  nextLink?: string
}

export interface MicrosoftAdListDirectoryAuditsParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  nextLink?: string
}

export interface MicrosoftAdListUserAppRoleAssignmentsParams extends MicrosoftAdBaseParams {
  userId?: string
  top?: number
  filter?: string
  nextLink?: string
}

export interface MicrosoftAdAddUserAppRoleAssignmentParams extends MicrosoftAdBaseParams {
  userId: string
  resourceId: string
  appRoleId: string
}

export interface MicrosoftAdRemoveUserAppRoleAssignmentParams extends MicrosoftAdBaseParams {
  userId: string
  appRoleAssignmentId: string
}

export interface MicrosoftAdListServicePrincipalsParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  search?: string
  nextLink?: string
}

export interface MicrosoftAdListServicePrincipalAppRoleAssignmentsParams
  extends MicrosoftAdBaseParams {
  servicePrincipalId?: string
  filter?: string
  nextLink?: string
}

export type MicrosoftAdListDirectoryRolesParams = MicrosoftAdBaseParams

export interface MicrosoftAdListDirectoryRoleMembersParams extends MicrosoftAdBaseParams {
  directoryRoleId: string
}

export interface MicrosoftAdAddDirectoryRoleMemberParams extends MicrosoftAdBaseParams {
  directoryRoleId: string
  memberId: string
}

export interface MicrosoftAdRemoveDirectoryRoleMemberParams extends MicrosoftAdBaseParams {
  directoryRoleId: string
  memberId: string
}

export interface MicrosoftAdListDevicesParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  search?: string
  nextLink?: string
}

export interface MicrosoftAdGetDeviceParams extends MicrosoftAdBaseParams {
  deviceObjectId: string
}

export interface MicrosoftAdListUserDevicesParams extends MicrosoftAdBaseParams {
  userId?: string
  deviceRelationship?: string
  top?: number
  nextLink?: string
}

export interface MicrosoftAdListConditionalAccessPoliciesParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  nextLink?: string
}

export interface MicrosoftAdGetConditionalAccessPolicyParams extends MicrosoftAdBaseParams {
  policyId: string
}

export const USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID' },
  displayName: { type: 'string', description: 'Display name' },
  givenName: { type: 'string', description: 'First name' },
  surname: { type: 'string', description: 'Last name' },
  userPrincipalName: { type: 'string', description: 'User principal name (email)' },
  mail: { type: 'string', description: 'Email address' },
  jobTitle: { type: 'string', description: 'Job title' },
  department: { type: 'string', description: 'Department' },
  officeLocation: { type: 'string', description: 'Office location' },
  mobilePhone: { type: 'string', description: 'Mobile phone number' },
  accountEnabled: { type: 'boolean', description: 'Whether the account is enabled' },
} as const satisfies Record<string, OutputProperty>

/**
 * The properties `POST /users` returns by default. The create endpoint does not document
 * `$select`, so the response is limited to this set — notably it omits `department` and
 * `accountEnabled`, which the read endpoints do return.
 */
export const CREATED_USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID' },
  displayName: { type: 'string', description: 'Display name' },
  givenName: { type: 'string', description: 'First name' },
  surname: { type: 'string', description: 'Last name' },
  userPrincipalName: { type: 'string', description: 'User principal name (email)' },
  mail: { type: 'string', description: 'Email address' },
  jobTitle: { type: 'string', description: 'Job title' },
  officeLocation: { type: 'string', description: 'Office location' },
  mobilePhone: { type: 'string', description: 'Mobile phone number' },
  businessPhones: { type: 'array', description: 'Business phone numbers' },
  preferredLanguage: { type: 'string', description: 'Preferred language' },
} as const satisfies Record<string, OutputProperty>

export const GROUP_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Group ID' },
  displayName: { type: 'string', description: 'Display name' },
  description: { type: 'string', description: 'Group description' },
  mail: { type: 'string', description: 'Email address' },
  mailEnabled: { type: 'boolean', description: 'Whether mail is enabled' },
  mailNickname: { type: 'string', description: 'Mail nickname' },
  securityEnabled: { type: 'boolean', description: 'Whether security is enabled' },
  groupTypes: { type: 'array', description: 'Group types' },
  visibility: { type: 'string', description: 'Group visibility' },
  createdDateTime: { type: 'string', description: 'Creation date' },
} as const satisfies Record<string, OutputProperty>

export const MEMBER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Member ID' },
  displayName: { type: 'string', description: 'Display name' },
  mail: { type: 'string', description: 'Email address' },
  odataType: { type: 'string', description: 'Directory object type' },
} as const satisfies Record<string, OutputProperty>

export const SERVICE_PLAN_OUTPUT_PROPERTIES = {
  servicePlanId: { type: 'string', description: 'Service plan ID' },
  servicePlanName: { type: 'string', description: 'Service plan name' },
  provisioningStatus: { type: 'string', description: 'Provisioning status of the service plan' },
  appliesTo: { type: 'string', description: 'Whether the plan applies to "User" or "Company"' },
} as const satisfies Record<string, OutputProperty>

export const ASSIGNED_LICENSE_OUTPUT_PROPERTIES = {
  skuId: { type: 'string', description: 'SKU ID of the assigned license' },
  disabledPlans: { type: 'array', description: 'Service plan IDs disabled on this license' },
} as const satisfies Record<string, OutputProperty>

export const LICENSE_DETAIL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'License detail ID' },
  skuId: { type: 'string', description: 'SKU ID of the license' },
  skuPartNumber: { type: 'string', description: 'SKU part number (e.g., "ENTERPRISEPACK")' },
  servicePlans: {
    type: 'array',
    description: 'Service plans included in the license',
    items: {
      type: 'object',
      properties: SERVICE_PLAN_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

export const PREPAID_UNITS_OUTPUT_PROPERTIES = {
  enabled: { type: 'number', description: 'Number of units that are enabled' },
  suspended: { type: 'number', description: 'Number of units that are suspended' },
  warning: { type: 'number', description: 'Number of units that are in warning status' },
  lockedOut: { type: 'number', description: 'Number of units that are locked out' },
} as const satisfies Record<string, OutputProperty>

export const SUBSCRIBED_SKU_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Subscribed SKU object ID' },
  skuId: { type: 'string', description: 'SKU ID, used when assigning or removing licenses' },
  skuPartNumber: { type: 'string', description: 'SKU part number (e.g., "ENTERPRISEPACK")' },
  appliesTo: { type: 'string', description: 'Whether the SKU applies to "User" or "Company"' },
  capabilityStatus: { type: 'string', description: 'Capability status of the subscription' },
  consumedUnits: { type: 'number', description: 'Number of licenses currently assigned' },
  prepaidUnits: {
    type: 'object',
    description: 'Prepaid license unit counts by status',
    properties: PREPAID_UNITS_OUTPUT_PROPERTIES,
  },
  servicePlans: {
    type: 'array',
    description: 'Service plans included in the SKU',
    items: {
      type: 'object',
      properties: SERVICE_PLAN_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

export const AUTHENTICATION_METHOD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Authentication method ID' },
  odataType: {
    type: 'string',
    description:
      'Authentication method type (e.g., "#microsoft.graph.phoneAuthenticationMethod"). Method-specific details vary by type.',
  },
  createdDateTime: {
    type: 'string',
    description: 'When the authentication method was registered',
  },
} as const satisfies Record<string, OutputProperty>

export const SIGN_IN_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Sign-in event ID' },
  createdDateTime: { type: 'string', description: 'When the sign-in was initiated' },
  userId: { type: 'string', description: 'ID of the user who signed in' },
  userDisplayName: { type: 'string', description: 'Display name of the user' },
  userPrincipalName: { type: 'string', description: 'User principal name of the user' },
  appId: { type: 'string', description: 'ID of the application used to sign in' },
  appDisplayName: { type: 'string', description: 'Display name of the application' },
  resourceId: { type: 'string', description: 'ID of the resource that was accessed' },
  resourceDisplayName: { type: 'string', description: 'Display name of the resource' },
  ipAddress: { type: 'string', description: 'IP address the sign-in came from' },
  clientAppUsed: { type: 'string', description: 'Legacy client app used to sign in' },
  correlationId: { type: 'string', description: 'Correlation ID for the sign-in request' },
  conditionalAccessStatus: {
    type: 'string',
    description: 'Conditional access result: success, failure, notApplied, or unknownFutureValue',
  },
  isInteractive: { type: 'boolean', description: 'Whether the sign-in was interactive' },
  riskDetail: { type: 'string', description: 'Reason behind a specific risk state' },
  riskLevelAggregated: { type: 'string', description: 'Aggregated risk level for the sign-in' },
  riskState: { type: 'string', description: 'Risk state of the user or sign-in' },
  errorCode: {
    type: 'number',
    description: 'Sign-in status error code. 0 indicates a successful sign-in.',
  },
  failureReason: { type: 'string', description: 'Failure reason from the sign-in status' },
  deviceDisplayName: { type: 'string', description: 'Display name of the device used' },
  deviceId: { type: 'string', description: 'ID of the device used' },
  deviceOperatingSystem: { type: 'string', description: 'Operating system of the device used' },
  deviceBrowser: { type: 'string', description: 'Browser used to sign in' },
  deviceIsCompliant: { type: 'boolean', description: 'Whether the device is compliant' },
  deviceIsManaged: { type: 'boolean', description: 'Whether the device is managed' },
  locationCity: { type: 'string', description: 'City the sign-in came from' },
  locationState: { type: 'string', description: 'State the sign-in came from' },
  locationCountryOrRegion: {
    type: 'string',
    description: 'Two-letter country or region code the sign-in came from',
  },
} as const satisfies Record<string, OutputProperty>

export const DIRECTORY_AUDIT_TARGET_RESOURCE_PROPERTIES = {
  id: { type: 'string', description: 'ID of the target resource' },
  displayName: { type: 'string', description: 'Display name of the target resource' },
  type: { type: 'string', description: 'Type of the target resource (e.g., User, Group)' },
  userPrincipalName: {
    type: 'string',
    description: 'User principal name of the target, null for non-user resources',
  },
} as const satisfies Record<string, OutputProperty>

export const DIRECTORY_AUDIT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Audit record ID' },
  activityDateTime: { type: 'string', description: 'When the activity took place' },
  activityDisplayName: { type: 'string', description: 'Name of the activity' },
  category: { type: 'string', description: 'Category of the activity' },
  correlationId: { type: 'string', description: 'Correlation ID for the activity' },
  loggedByService: { type: 'string', description: 'Service that logged the activity' },
  operationType: { type: 'string', description: 'Operation type (e.g., Add, Update, Delete)' },
  result: {
    type: 'string',
    description: 'Result of the activity: success, failure, timeout, or unknownFutureValue',
  },
  resultReason: { type: 'string', description: 'Reason for the result' },
  initiatedByUserId: { type: 'string', description: 'ID of the user who initiated the activity' },
  initiatedByUserPrincipalName: {
    type: 'string',
    description: 'User principal name of the initiating user',
  },
  initiatedByUserDisplayName: {
    type: 'string',
    description: 'Display name of the initiating user',
  },
  initiatedByAppId: { type: 'string', description: 'App ID that initiated the activity' },
  initiatedByAppDisplayName: {
    type: 'string',
    description: 'Display name of the app that initiated the activity',
  },
  targetResources: {
    type: 'array',
    description: 'Resources the activity acted on',
    items: {
      type: 'object',
      properties: DIRECTORY_AUDIT_TARGET_RESOURCE_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

export const APP_ROLE_ASSIGNMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'App role assignment ID, used when removing the assignment' },
  appRoleId: {
    type: 'string',
    description:
      'ID of the app role. All-zero GUID means the assignment grants access without a specific role.',
  },
  createdDateTime: { type: 'string', description: 'When the assignment was created' },
  principalId: { type: 'string', description: 'ID of the assigned principal' },
  principalDisplayName: { type: 'string', description: 'Display name of the assigned principal' },
  principalType: {
    type: 'string',
    description: 'Principal type: User, Group, or ServicePrincipal',
  },
  resourceId: {
    type: 'string',
    description: 'ID of the resource service principal that defines the app role',
  },
  resourceDisplayName: { type: 'string', description: 'Display name of the resource' },
} as const satisfies Record<string, OutputProperty>

export const SERVICE_PRINCIPAL_OUTPUT_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Service principal object ID, used as the resource ID of an app role assignment',
  },
  appId: { type: 'string', description: 'Application ID associated with the service principal' },
  displayName: { type: 'string', description: 'Display name of the service principal' },
  servicePrincipalType: {
    type: 'string',
    description: 'Type of service principal (e.g., Application, ManagedIdentity, Legacy)',
  },
  accountEnabled: {
    type: 'boolean',
    description: 'Whether users can sign in to the associated application',
  },
  appOwnerOrganizationId: {
    type: 'string',
    description: 'Tenant ID where the application is registered',
  },
  signInAudience: {
    type: 'string',
    description: 'Which Microsoft accounts are supported by the associated application',
  },
  tags: { type: 'array', description: 'Custom strings used to categorize the service principal' },
} as const satisfies Record<string, OutputProperty>

export const APP_ROLE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'App role ID, used when granting an app role assignment' },
  displayName: { type: 'string', description: 'Display name of the app role' },
  description: { type: 'string', description: 'Description of the app role' },
  value: { type: 'string', description: 'Value included in the roles claim for this app role' },
  isEnabled: { type: 'boolean', description: 'Whether the app role can be assigned' },
  allowedMemberTypes: {
    type: 'array',
    description: 'Principal types the app role can be assigned to (User and/or Application)',
  },
} as const satisfies Record<string, OutputProperty>

export const DIRECTORY_ROLE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Directory role object ID' },
  displayName: { type: 'string', description: 'Display name of the directory role' },
  description: { type: 'string', description: 'Description of the directory role' },
  roleTemplateId: { type: 'string', description: 'ID of the directory role template' },
} as const satisfies Record<string, OutputProperty>

export const DEVICE_OUTPUT_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Device object ID, used to get, update, or delete the device',
  },
  deviceId: { type: 'string', description: 'Unique device identifier set during registration' },
  displayName: { type: 'string', description: 'Display name of the device' },
  operatingSystem: { type: 'string', description: 'Operating system of the device' },
  operatingSystemVersion: { type: 'string', description: 'Operating system version of the device' },
  accountEnabled: { type: 'boolean', description: 'Whether the device is enabled' },
  isCompliant: { type: 'boolean', description: 'Whether the device complies with MDM policies' },
  isManaged: { type: 'boolean', description: 'Whether the device is managed by an MDM app' },
  trustType: {
    type: 'string',
    description: 'Device registration type: Workplace, AzureAd, or ServerAd',
  },
  profileType: {
    type: 'string',
    description: 'Device profile type: RegisteredDevice, SecureVM, Printer, Shared, or IoT',
  },
  manufacturer: { type: 'string', description: 'Manufacturer of the device' },
  model: { type: 'string', description: 'Model of the device' },
  approximateLastSignInDateTime: {
    type: 'string',
    description: 'Approximate time the device last signed in',
  },
  registrationDateTime: { type: 'string', description: 'When the device was registered' },
} as const satisfies Record<string, OutputProperty>

export const CONDITIONAL_ACCESS_POLICY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Conditional access policy ID' },
  displayName: { type: 'string', description: 'Display name of the policy' },
  state: {
    type: 'string',
    description: 'Policy state: enabled, disabled, or enabledForReportingButNotEnforced',
  },
  templateId: { type: 'string', description: 'ID of the template the policy was created from' },
  createdDateTime: { type: 'string', description: 'When the policy was created' },
  modifiedDateTime: { type: 'string', description: 'When the policy was last modified' },
  conditions: {
    type: 'json',
    description:
      'Conditions that trigger the policy (users, applications, platforms, locations, risk levels)',
  },
  grantControls: {
    type: 'json',
    description: 'Controls enforced when the policy applies, or null when none are configured',
  },
  sessionControls: {
    type: 'json',
    description: 'Session controls enforced when the policy applies, or null when none are set',
  },
} as const satisfies Record<string, OutputProperty>

export interface MicrosoftAdAssignLicenseResponse extends ToolResponse {
  output: {
    userId: string | null
    displayName: string | null
    userPrincipalName: string | null
    assignedLicenses: Array<Record<string, unknown>>
  }
}

export interface MicrosoftAdListUserLicensesResponse extends ToolResponse {
  output: {
    licenses: Array<Record<string, unknown>>
    licenseCount: number
  }
}

export interface MicrosoftAdListSubscribedSkusResponse extends ToolResponse {
  output: {
    skus: Array<Record<string, unknown>>
    skuCount: number
  }
}

export interface MicrosoftAdRevokeSignInSessionsResponse extends ToolResponse {
  output: {
    revoked: boolean
    userId: string
  }
}

export interface MicrosoftAdSetPasswordResponse extends ToolResponse {
  output: {
    updated: boolean
    userId: string
    forceChangePasswordNextSignIn: boolean
  }
}

export interface MicrosoftAdResetPasswordResponse extends ToolResponse {
  output: {
    accepted: boolean
    userId: string
    newPassword: string | null
    operationLocation: string | null
  }
}

export interface MicrosoftAdListAuthenticationMethodsResponse extends ToolResponse {
  output: {
    methods: Array<Record<string, unknown>>
    methodCount: number
  }
}

export interface MicrosoftAdListSignInsResponse extends ToolResponse {
  output: {
    signIns: Array<Record<string, unknown>>
    signInCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdListDirectoryAuditsResponse extends ToolResponse {
  output: {
    audits: Array<Record<string, unknown>>
    auditCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdListAppRoleAssignmentsResponse extends ToolResponse {
  output: {
    assignments: Array<Record<string, unknown>>
    assignmentCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdAddUserAppRoleAssignmentResponse extends ToolResponse {
  output: {
    assignment: Record<string, unknown>
  }
}

export interface MicrosoftAdRemoveUserAppRoleAssignmentResponse extends ToolResponse {
  output: {
    removed: boolean
    userId: string
    appRoleAssignmentId: string
  }
}

export interface MicrosoftAdListServicePrincipalsResponse extends ToolResponse {
  output: {
    servicePrincipals: Array<Record<string, unknown>>
    servicePrincipalCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdListDirectoryRolesResponse extends ToolResponse {
  output: {
    roles: Array<Record<string, unknown>>
    roleCount: number
  }
}

export interface MicrosoftAdListDirectoryRoleMembersResponse extends ToolResponse {
  output: {
    members: Array<Record<string, unknown>>
    memberCount: number
  }
}

export interface MicrosoftAdAddDirectoryRoleMemberResponse extends ToolResponse {
  output: {
    added: boolean
    directoryRoleId: string
    memberId: string
  }
}

export interface MicrosoftAdRemoveDirectoryRoleMemberResponse extends ToolResponse {
  output: {
    removed: boolean
    directoryRoleId: string
    memberId: string
  }
}

export interface MicrosoftAdListDevicesResponse extends ToolResponse {
  output: {
    devices: Array<Record<string, unknown>>
    deviceCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdGetDeviceResponse extends ToolResponse {
  output: {
    device: Record<string, unknown>
  }
}

export interface MicrosoftAdListConditionalAccessPoliciesResponse extends ToolResponse {
  output: {
    policies: Array<Record<string, unknown>>
    policyCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdGetConditionalAccessPolicyResponse extends ToolResponse {
  output: {
    policy: Record<string, unknown>
  }
}

export interface MicrosoftAdListUsersResponse extends ToolResponse {
  output: {
    users: Array<Record<string, unknown>>
    userCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdGetUserResponse extends ToolResponse {
  output: {
    user: Record<string, unknown>
  }
}

export interface MicrosoftAdCreateUserResponse extends ToolResponse {
  output: {
    user: Record<string, unknown>
  }
}

export interface MicrosoftAdUpdateUserResponse extends ToolResponse {
  output: {
    updated: boolean
    userId: string
  }
}

export interface MicrosoftAdDeleteUserResponse extends ToolResponse {
  output: {
    deleted: boolean
    userId: string
  }
}

export interface MicrosoftAdListGroupsResponse extends ToolResponse {
  output: {
    groups: Array<Record<string, unknown>>
    groupCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdGetGroupResponse extends ToolResponse {
  output: {
    group: Record<string, unknown>
  }
}

export interface MicrosoftAdCreateGroupResponse extends ToolResponse {
  output: {
    group: Record<string, unknown>
  }
}

export interface MicrosoftAdUpdateGroupResponse extends ToolResponse {
  output: {
    updated: boolean
    groupId: string
  }
}

export interface MicrosoftAdDeleteGroupResponse extends ToolResponse {
  output: {
    deleted: boolean
    groupId: string
  }
}

export interface MicrosoftAdListGroupMembersResponse extends ToolResponse {
  output: {
    members: Array<Record<string, unknown>>
    memberCount: number
    nextLink: string | null
  }
}

export interface MicrosoftAdAddGroupMemberResponse extends ToolResponse {
  output: {
    added: boolean
    groupId: string
    memberId: string
  }
}

export interface MicrosoftAdRemoveGroupMemberResponse extends ToolResponse {
  output: {
    removed: boolean
    groupId: string
    memberId: string
  }
}

export type MicrosoftAdResponse =
  | MicrosoftAdListUsersResponse
  | MicrosoftAdGetUserResponse
  | MicrosoftAdCreateUserResponse
  | MicrosoftAdUpdateUserResponse
  | MicrosoftAdDeleteUserResponse
  | MicrosoftAdListGroupsResponse
  | MicrosoftAdGetGroupResponse
  | MicrosoftAdCreateGroupResponse
  | MicrosoftAdUpdateGroupResponse
  | MicrosoftAdDeleteGroupResponse
  | MicrosoftAdListGroupMembersResponse
  | MicrosoftAdAddGroupMemberResponse
  | MicrosoftAdRemoveGroupMemberResponse
  | MicrosoftAdAssignLicenseResponse
  | MicrosoftAdListUserLicensesResponse
  | MicrosoftAdListSubscribedSkusResponse
  | MicrosoftAdRevokeSignInSessionsResponse
  | MicrosoftAdSetPasswordResponse
  | MicrosoftAdResetPasswordResponse
  | MicrosoftAdListAuthenticationMethodsResponse
  | MicrosoftAdListSignInsResponse
  | MicrosoftAdListDirectoryAuditsResponse
  | MicrosoftAdListAppRoleAssignmentsResponse
  | MicrosoftAdAddUserAppRoleAssignmentResponse
  | MicrosoftAdRemoveUserAppRoleAssignmentResponse
  | MicrosoftAdListServicePrincipalsResponse
  | MicrosoftAdListDirectoryRolesResponse
  | MicrosoftAdListDirectoryRoleMembersResponse
  | MicrosoftAdAddDirectoryRoleMemberResponse
  | MicrosoftAdRemoveDirectoryRoleMemberResponse
  | MicrosoftAdListDevicesResponse
  | MicrosoftAdGetDeviceResponse
  | MicrosoftAdListConditionalAccessPoliciesResponse
  | MicrosoftAdGetConditionalAccessPolicyResponse
