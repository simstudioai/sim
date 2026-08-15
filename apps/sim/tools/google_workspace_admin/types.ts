import type { ToolResponse } from '@/tools/types'

/**
 * Shared parameters for every Google Workspace Admin SDK call.
 */
interface GoogleWorkspaceAdminCommonParams {
  accessToken: string
}

/** Parameters for `users.list`. */
export interface GoogleWorkspaceAdminListUsersParams extends GoogleWorkspaceAdminCommonParams {
  customer?: string
  domain?: string
  query?: string
  maxResults?: number
  pageToken?: string
  orderBy?: 'EMAIL' | 'FAMILY_NAME' | 'GIVEN_NAME'
  sortOrder?: 'ASCENDING' | 'DESCENDING'
  projection?: 'BASIC' | 'CUSTOM' | 'FULL'
  showDeleted?: boolean
  viewType?: 'admin_view' | 'domain_public'
}

/** Parameters for `users.get`. */
export interface GoogleWorkspaceAdminGetUserParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
  projection?: 'BASIC' | 'CUSTOM' | 'FULL'
  viewType?: 'admin_view' | 'domain_public'
}

/** Parameters for `users.insert`. */
export interface GoogleWorkspaceAdminCreateUserParams extends GoogleWorkspaceAdminCommonParams {
  primaryEmail: string
  givenName: string
  familyName: string
  password: string
  changePasswordAtNextLogin?: boolean
  orgUnitPath?: string
  suspended?: boolean
  recoveryEmail?: string
  recoveryPhone?: string
}

/** Parameters for `users.update`. */
export interface GoogleWorkspaceAdminUpdateUserParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
  primaryEmail?: string
  givenName?: string
  familyName?: string
  orgUnitPath?: string
  suspended?: boolean
  recoveryEmail?: string
  recoveryPhone?: string
}

/** Parameters for `users.delete`. */
export interface GoogleWorkspaceAdminDeleteUserParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
}

/** Parameters for the suspend/unsuspend variants of `users.patch`. */
export interface GoogleWorkspaceAdminSuspendUserParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
}

/** Parameters for the password-reset variant of `users.patch`. */
export interface GoogleWorkspaceAdminResetPasswordParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
  password: string
  changePasswordAtNextLogin?: boolean
  hashFunction?: 'MD5' | 'SHA-1' | 'crypt'
}

/** Parameters for the org-unit-move variant of `users.patch`. */
export interface GoogleWorkspaceAdminMoveUserParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
  orgUnitPath: string
}

/** Parameters for `users.makeAdmin`. */
export interface GoogleWorkspaceAdminMakeAdminParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
}

/** Parameters for `users.signOut`. */
export interface GoogleWorkspaceAdminSignOutUserParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
}

/** Parameters for `users.aliases.list`. */
export interface GoogleWorkspaceAdminListUserAliasesParams
  extends GoogleWorkspaceAdminCommonParams {
  userKey: string
}

/** Parameters for `users.aliases.insert`. */
export interface GoogleWorkspaceAdminAddUserAliasParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
  alias: string
}

/** Parameters for `users.aliases.delete`. */
export interface GoogleWorkspaceAdminRemoveUserAliasParams
  extends GoogleWorkspaceAdminCommonParams {
  userKey: string
  alias: string
}

/** Parameters for `tokens.list`. */
export interface GoogleWorkspaceAdminListUserTokensParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
}

/** Parameters for `tokens.delete`. */
export interface GoogleWorkspaceAdminRevokeUserTokenParams
  extends GoogleWorkspaceAdminCommonParams {
  userKey: string
  clientId: string
}

/** Parameters for `orgunits.list`. */
export interface GoogleWorkspaceAdminListOrgUnitsParams extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  orgUnitPath?: string
  type?: 'ALL' | 'CHILDREN' | 'ALL_INCLUDING_PARENT'
}

/** Parameters for `orgunits.get` and `orgunits.delete`. */
export interface GoogleWorkspaceAdminOrgUnitKeyParams extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  orgUnitPath: string
}

/** Parameters for `orgunits.insert`. */
export interface GoogleWorkspaceAdminCreateOrgUnitParams extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  name: string
  parentOrgUnitPath: string
  description?: string
}

/** Parameters for `orgunits.update`. */
export interface GoogleWorkspaceAdminUpdateOrgUnitParams extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  orgUnitPath: string
  name?: string
  parentOrgUnitPath?: string
  description?: string
}

/** Parameters for `roles.list`. */
export interface GoogleWorkspaceAdminListRolesParams extends GoogleWorkspaceAdminCommonParams {
  customer?: string
  maxResults?: number
  pageToken?: string
}

/** Parameters for `roles.get`. */
export interface GoogleWorkspaceAdminGetRoleParams extends GoogleWorkspaceAdminCommonParams {
  customer?: string
  roleId: string
}

/** Parameters for `roleAssignments.list`. */
export interface GoogleWorkspaceAdminListRoleAssignmentsParams
  extends GoogleWorkspaceAdminCommonParams {
  customer?: string
  roleId?: string
  userKey?: string
  includeIndirectRoleAssignments?: boolean
  maxResults?: number
  pageToken?: string
}

/** Parameters for `roleAssignments.insert`. */
export interface GoogleWorkspaceAdminCreateRoleAssignmentParams
  extends GoogleWorkspaceAdminCommonParams {
  customer?: string
  roleId: string
  assignedTo: string
  scopeType?: 'CUSTOMER' | 'ORG_UNIT'
  orgUnitId?: string
}

/** Parameters for `roleAssignments.delete`. */
export interface GoogleWorkspaceAdminDeleteRoleAssignmentParams
  extends GoogleWorkspaceAdminCommonParams {
  customer?: string
  roleAssignmentId: string
}

/** Parameters for `mobiledevices.list`. */
export interface GoogleWorkspaceAdminListMobileDevicesParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  query?: string
  maxResults?: number
  pageToken?: string
  orderBy?: 'DEVICE_ID' | 'EMAIL' | 'LAST_SYNC' | 'MODEL' | 'NAME' | 'OS' | 'STATUS' | 'TYPE'
  sortOrder?: 'ASCENDING' | 'DESCENDING'
  projection?: 'BASIC' | 'FULL'
}

/** Parameters for `mobiledevices.get`. */
export interface GoogleWorkspaceAdminGetMobileDeviceParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  resourceId: string
  projection?: 'BASIC' | 'FULL'
}

/** Parameters for `mobiledevices.action`. */
export interface GoogleWorkspaceAdminMobileDeviceActionParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  resourceId: string
  action:
    | 'admin_remote_wipe'
    | 'admin_account_wipe'
    | 'approve'
    | 'block'
    | 'cancel_remote_wipe_then_activate'
    | 'cancel_remote_wipe_then_block'
}

/** Parameters for `chromeosdevices.list`. */
export interface GoogleWorkspaceAdminListChromeOsDevicesParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  orgUnitPath?: string
  query?: string
  maxResults?: number
  pageToken?: string
  orderBy?:
    | 'ANNOTATED_LOCATION'
    | 'ANNOTATED_USER'
    | 'LAST_SYNC'
    | 'NOTES'
    | 'SERIAL_NUMBER'
    | 'STATUS'
  sortOrder?: 'ASCENDING' | 'DESCENDING'
  projection?: 'BASIC' | 'FULL'
  includeChildOrgunits?: boolean
}

/** Parameters for `chromeosdevices.get`. */
export interface GoogleWorkspaceAdminGetChromeOsDeviceParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  deviceId: string
  projection?: 'BASIC' | 'FULL'
}

/** Parameters for `chromeosdevices.update`. */
export interface GoogleWorkspaceAdminUpdateChromeOsDeviceParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  deviceId: string
  annotatedUser?: string
  annotatedLocation?: string
  annotatedAssetId?: string
  notes?: string
  orgUnitPath?: string
}

/** Parameters for `activities.list`. */
export interface GoogleWorkspaceAdminListActivitiesParams extends GoogleWorkspaceAdminCommonParams {
  applicationName: string
  userKey?: string
  eventName?: string
  actorIpAddress?: string
  startTime?: string
  endTime?: string
  filters?: string
  orgUnitID?: string
  groupIdFilter?: string
  maxResults?: number
  pageToken?: string
}

/** Parameters for `customerUsageReports.get`. */
export interface GoogleWorkspaceAdminCustomerUsageReportParams
  extends GoogleWorkspaceAdminCommonParams {
  date: string
  customerId?: string
  parameters?: string
  pageToken?: string
}

/** Parameters for `userUsageReport.get`. */
export interface GoogleWorkspaceAdminUserUsageReportParams
  extends GoogleWorkspaceAdminCommonParams {
  date: string
  userKey?: string
  customerId?: string
  parameters?: string
  filters?: string
  orgUnitID?: string
  groupIdFilter?: string
  maxResults?: number
  pageToken?: string
}

/**
 * Union of every documented Google Workspace Admin tool output. Each tool
 * populates only the fields its endpoint documents.
 */
export interface GoogleWorkspaceAdminResponse extends ToolResponse {
  output: {
    users?: unknown[]
    user?: unknown
    aliases?: unknown[]
    alias?: unknown
    tokens?: unknown[]
    organizationUnits?: unknown[]
    orgUnit?: unknown
    roles?: unknown[]
    role?: unknown
    roleAssignments?: unknown[]
    roleAssignment?: unknown
    mobileDevices?: unknown[]
    mobileDevice?: unknown
    chromeOsDevices?: unknown[]
    chromeOsDevice?: unknown
    activities?: unknown[]
    usageReports?: unknown[]
    warnings?: unknown[]
    message?: string
    nextPageToken?: string
  }
}
