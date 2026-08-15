import type {
  CHROMEOS_ORDER_BY,
  DEVICE_PROJECTION,
  MOBILE_ORDER_BY,
  ORG_UNIT_LIST_TYPE,
  SORT_ORDER,
  USER_ORDER_BY,
  USER_PROJECTION,
  USER_VIEW_TYPE,
} from '@/tools/google_workspace_admin/utils'
import type { ToolResponse } from '@/tools/types'

/** Enum unions derived from the Directory API discovery document. */
type UserOrderBy = (typeof USER_ORDER_BY)[number]
type UserProjection = (typeof USER_PROJECTION)[number]
type UserViewType = (typeof USER_VIEW_TYPE)[number]
type OrgUnitListType = (typeof ORG_UNIT_LIST_TYPE)[number]
type ChromeOsOrderBy = (typeof CHROMEOS_ORDER_BY)[number]
type MobileOrderBy = (typeof MOBILE_ORDER_BY)[number]
type DeviceProjection = (typeof DEVICE_PROJECTION)[number]
type SortOrder = (typeof SORT_ORDER)[number]

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
  orderBy?: UserOrderBy
  sortOrder?: SortOrder
  projection?: UserProjection
  showDeleted?: boolean
  viewType?: UserViewType
}

/** Parameters for `users.get`. */
export interface GoogleWorkspaceAdminGetUserParams extends GoogleWorkspaceAdminCommonParams {
  userKey: string
  projection?: UserProjection
  viewType?: UserViewType
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
  type?: OrgUnitListType
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
  orderBy?: MobileOrderBy
  sortOrder?: SortOrder
  projection?: DeviceProjection
}

/** Parameters for `mobiledevices.get`. */
export interface GoogleWorkspaceAdminGetMobileDeviceParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  resourceId: string
  projection?: DeviceProjection
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
  orderBy?: ChromeOsOrderBy
  sortOrder?: SortOrder
  projection?: DeviceProjection
  includeChildOrgunits?: boolean
}

/** Parameters for `chromeosdevices.get`. */
export interface GoogleWorkspaceAdminGetChromeOsDeviceParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  deviceId: string
  projection?: DeviceProjection
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

/** Parameters for `customer.devices.chromeos.batchChangeStatus`. */
export interface GoogleWorkspaceAdminBatchChangeChromeOsDeviceStatusParams
  extends GoogleWorkspaceAdminCommonParams {
  customerId?: string
  deviceIds: string
  changeChromeOsDeviceStatusAction:
    | 'CHANGE_CHROME_OS_DEVICE_STATUS_ACTION_DEPROVISION'
    | 'CHANGE_CHROME_OS_DEVICE_STATUS_ACTION_DISABLE'
    | 'CHANGE_CHROME_OS_DEVICE_STATUS_ACTION_REENABLE'
  deprovisionReason?:
    | 'DEPROVISION_REASON_SAME_MODEL_REPLACEMENT'
    | 'DEPROVISION_REASON_DIFFERENT_MODEL_REPLACEMENT'
    | 'DEPROVISION_REASON_RETIRING_DEVICE'
    | 'DEPROVISION_REASON_UPGRADE_TRANSFER'
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
    changeChromeOsDeviceStatusResults?: unknown[]
    activities?: unknown[]
    usageReports?: unknown[]
    warnings?: unknown[]
    message?: string
    nextPageToken?: string
  }
}
