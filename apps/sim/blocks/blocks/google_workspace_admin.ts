import { GoogleWorkspaceAdminIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'

/** Coerces a subblock value to a number, dropping blanks so the API applies its own default. */
function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** Coerces a switch subblock value to a boolean, leaving untouched switches undefined. */
function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  return value === 'true'
}

const USER_KEY_OPERATIONS = [
  'get_user',
  'update_user',
  'delete_user',
  'suspend_user',
  'unsuspend_user',
  'reset_password',
  'move_user_org_unit',
  'make_admin',
  'revoke_admin',
  'sign_out_user',
  'list_user_aliases',
  'add_user_alias',
  'remove_user_alias',
  'list_user_tokens',
  'revoke_user_token',
] as const

const CUSTOMER_OPERATIONS = [
  'list_users',
  'list_org_units',
  'get_org_unit',
  'create_org_unit',
  'update_org_unit',
  'delete_org_unit',
  'list_roles',
  'get_role',
  'list_role_assignments',
  'create_role_assignment',
  'delete_role_assignment',
  'list_mobile_devices',
  'get_mobile_device',
  'action_mobile_device',
  'list_chromeos_devices',
  'get_chromeos_device',
  'update_chromeos_device',
  'get_customer_usage_report',
  'get_user_usage_report',
] as const

const PAGINATED_OPERATIONS = [
  'list_users',
  'list_roles',
  'list_role_assignments',
  'list_mobile_devices',
  'list_chromeos_devices',
  'list_activities',
  'get_customer_usage_report',
  'get_user_usage_report',
] as const

const MAX_RESULTS_OPERATIONS = [
  'list_users',
  'list_roles',
  'list_role_assignments',
  'list_mobile_devices',
  'list_chromeos_devices',
  'list_activities',
  'get_user_usage_report',
] as const

const ORG_UNIT_PATH_OPERATIONS = [
  'get_org_unit',
  'update_org_unit',
  'delete_org_unit',
  'list_org_units',
  'create_user',
  'update_user',
  'move_user_org_unit',
  'list_chromeos_devices',
  'update_chromeos_device',
] as const

const ORG_UNIT_PATH_REQUIRED_OPERATIONS = [
  'get_org_unit',
  'update_org_unit',
  'delete_org_unit',
  'move_user_org_unit',
] as const

/** Every operation the block can dispatch, used to reject unknown dropdown values. */
const SUPPORTED_OPERATIONS = new Set([
  'list_users',
  'get_user',
  'create_user',
  'update_user',
  'delete_user',
  'suspend_user',
  'unsuspend_user',
  'reset_password',
  'move_user_org_unit',
  'make_admin',
  'revoke_admin',
  'sign_out_user',
  'list_user_aliases',
  'add_user_alias',
  'remove_user_alias',
  'list_user_tokens',
  'revoke_user_token',
  'list_org_units',
  'get_org_unit',
  'create_org_unit',
  'update_org_unit',
  'delete_org_unit',
  'list_roles',
  'get_role',
  'list_role_assignments',
  'create_role_assignment',
  'delete_role_assignment',
  'list_mobile_devices',
  'get_mobile_device',
  'action_mobile_device',
  'list_chromeos_devices',
  'get_chromeos_device',
  'update_chromeos_device',
  'list_activities',
  'get_customer_usage_report',
  'get_user_usage_report',
])

export const GoogleWorkspaceAdminBlock: BlockConfig = {
  type: 'google_workspace_admin',
  name: 'Google Workspace Admin',
  description: 'Manage Google Workspace users, org units, admin roles, devices, and audit reports',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect to the Google Admin SDK to run joiner, mover, and leaver work: create and suspend users, move them between org units, reset passwords, grant and revoke admin roles, wipe or block devices, and read audit and usage reports.',
  docsLink: 'https://docs.sim.ai/integrations/google_workspace_admin',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#E8F0FE',
  icon: GoogleWorkspaceAdminIcon,
  canvasPresentation: {
    defaultTitle: 'Google Workspace Admin',
    sentences: {
      byOperation: {
        list_users: [
          'List users',
          { text: 'in', field: 'domain' },
          { text: ', matching', field: 'query' },
        ],
        get_user: [{ text: 'Read user', field: 'userKey', core: true }],
        create_user: [
          { text: 'Create user', field: 'primaryEmail', core: true },
          { text: 'in', field: 'orgUnitPath' },
        ],
        update_user: [{ text: 'Update user', field: 'userKey', core: true }],
        delete_user: [{ text: 'Delete user', field: 'userKey', core: true }],
        suspend_user: [{ text: 'Suspend user', field: 'userKey', core: true }],
        unsuspend_user: [{ text: 'Restore user', field: 'userKey', core: true }],
        reset_password: [{ text: 'Reset the password of', field: 'userKey', core: true }],
        move_user_org_unit: [
          { text: 'Move user', field: 'userKey', core: true },
          { text: 'to', field: 'orgUnitPath', core: true },
        ],
        make_admin: [{ text: 'Grant super admin to', field: 'userKey', core: true }],
        revoke_admin: [{ text: 'Revoke super admin from', field: 'userKey', core: true }],
        sign_out_user: [{ text: 'Sign out', field: 'userKey', core: true }],
        list_user_aliases: [{ text: 'List aliases of', field: 'userKey', core: true }],
        add_user_alias: [
          { text: 'Add alias', field: 'alias', core: true },
          { text: 'to', field: 'userKey', core: true },
        ],
        remove_user_alias: [
          { text: 'Remove alias', field: 'alias', core: true },
          { text: 'from', field: 'userKey', core: true },
        ],
        list_user_tokens: [
          { text: 'List application tokens issued by', field: 'userKey', core: true },
        ],
        revoke_user_token: [
          { text: 'Revoke tokens for app', field: 'clientId', core: true },
          { text: 'issued by', field: 'userKey', core: true },
        ],
        list_org_units: ['List org units', { text: 'under', field: 'orgUnitPath' }],
        get_org_unit: [{ text: 'Read org unit', field: 'orgUnitPath', core: true }],
        create_org_unit: [
          { text: 'Create org unit', field: 'name', core: true },
          { text: 'under', field: 'parentOrgUnitPath', core: true },
        ],
        update_org_unit: [{ text: 'Update org unit', field: 'orgUnitPath', core: true }],
        delete_org_unit: [{ text: 'Delete org unit', field: 'orgUnitPath', core: true }],
        list_roles: ['List admin roles'],
        get_role: [{ text: 'Read admin role', field: 'roleId', core: true }],
        list_role_assignments: [
          'List role assignments',
          { text: 'for role', field: 'roleId' },
          { text: ', held by', field: 'userKey' },
        ],
        create_role_assignment: [
          { text: 'Grant role', field: 'roleId', core: true },
          { text: 'to', field: 'assignedTo', core: true },
        ],
        delete_role_assignment: [
          { text: 'Revoke role assignment', field: 'roleAssignmentId', core: true },
        ],
        list_mobile_devices: ['List mobile devices', { text: 'matching', field: 'query' }],
        get_mobile_device: [{ text: 'Read mobile device', field: 'resourceId', core: true }],
        action_mobile_device: [
          { text: 'Run', field: 'action', core: true },
          { text: 'on mobile device', field: 'resourceId', core: true },
        ],
        list_chromeos_devices: [
          'List ChromeOS devices',
          { text: 'in', field: 'orgUnitPath' },
          { text: ', matching', field: 'query' },
        ],
        get_chromeos_device: [{ text: 'Read ChromeOS device', field: 'deviceId', core: true }],
        update_chromeos_device: [{ text: 'Update ChromeOS device', field: 'deviceId', core: true }],
        list_activities: [
          { text: 'Read audit log', field: 'applicationName', core: true },
          { text: 'for', field: 'userKey' },
        ],
        get_customer_usage_report: [{ text: 'Read account usage for', field: 'date', core: true }],
        get_user_usage_report: [
          { text: 'Read user usage for', field: 'date', core: true },
          { text: ', for', field: 'userKey' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Create User', id: 'create_user' },
        { label: 'Update User', id: 'update_user' },
        { label: 'Delete User', id: 'delete_user' },
        { label: 'Suspend User', id: 'suspend_user' },
        { label: 'Unsuspend User', id: 'unsuspend_user' },
        { label: 'Reset Password', id: 'reset_password' },
        { label: 'Move User Org Unit', id: 'move_user_org_unit' },
        { label: 'Make Admin', id: 'make_admin' },
        { label: 'Revoke Admin', id: 'revoke_admin' },
        { label: 'Sign Out User', id: 'sign_out_user' },
        { label: 'List User Aliases', id: 'list_user_aliases' },
        { label: 'Add User Alias', id: 'add_user_alias' },
        { label: 'Remove User Alias', id: 'remove_user_alias' },
        { label: 'List User Tokens', id: 'list_user_tokens' },
        { label: 'Revoke User Token', id: 'revoke_user_token' },
        { label: 'List Org Units', id: 'list_org_units' },
        { label: 'Get Org Unit', id: 'get_org_unit' },
        { label: 'Create Org Unit', id: 'create_org_unit' },
        { label: 'Update Org Unit', id: 'update_org_unit' },
        { label: 'Delete Org Unit', id: 'delete_org_unit' },
        { label: 'List Roles', id: 'list_roles' },
        { label: 'Get Role', id: 'get_role' },
        { label: 'List Role Assignments', id: 'list_role_assignments' },
        { label: 'Create Role Assignment', id: 'create_role_assignment' },
        { label: 'Delete Role Assignment', id: 'delete_role_assignment' },
        { label: 'List Mobile Devices', id: 'list_mobile_devices' },
        { label: 'Get Mobile Device', id: 'get_mobile_device' },
        { label: 'Action Mobile Device', id: 'action_mobile_device' },
        { label: 'List ChromeOS Devices', id: 'list_chromeos_devices' },
        { label: 'Get ChromeOS Device', id: 'get_chromeos_device' },
        { label: 'Update ChromeOS Device', id: 'update_chromeos_device' },
        { label: 'List Activities', id: 'list_activities' },
        { label: 'Get Customer Usage Report', id: 'get_customer_usage_report' },
        { label: 'Get User Usage Report', id: 'get_user_usage_report' },
      ],
      value: () => 'list_users',
    },
    {
      id: 'credential',
      title: 'Google Workspace Admin Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-workspace-admin',
      requiredScopes: getScopesForService('google-workspace-admin'),
      placeholder: 'Select Google Workspace admin account',
    },
    {
      id: 'manualCredential',
      title: 'Google Workspace Admin Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,

    {
      id: 'userKey',
      title: 'User Email or ID',
      type: 'short-input',
      placeholder: 'user@example.com or user ID',
      required: { field: 'operation', value: [...USER_KEY_OPERATIONS] },
      condition: {
        field: 'operation',
        value: [
          ...USER_KEY_OPERATIONS,
          'list_role_assignments',
          'list_activities',
          'get_user_usage_report',
        ],
      },
    },
    {
      id: 'primaryEmail',
      title: 'Primary Email',
      type: 'short-input',
      placeholder: 'jane.doe@example.com',
      required: { field: 'operation', value: 'create_user' },
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
    },
    {
      id: 'givenName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Jane',
      required: { field: 'operation', value: 'create_user' },
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
    },
    {
      id: 'familyName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      required: { field: 'operation', value: 'create_user' },
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: '8-100 characters',
      required: { field: 'operation', value: ['create_user', 'reset_password'] },
      condition: { field: 'operation', value: ['create_user', 'reset_password'] },
    },
    {
      id: 'changePasswordAtNextLogin',
      title: 'Change Password At Next Sign-In',
      type: 'switch',
      condition: { field: 'operation', value: ['create_user', 'reset_password'] },
    },
    {
      id: 'hashFunction',
      title: 'Password Hash Function',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { id: 'MD5', label: 'MD5' },
        { id: 'SHA-1', label: 'SHA-1' },
        { id: 'crypt', label: 'crypt' },
      ],
      condition: { field: 'operation', value: 'reset_password' },
    },
    {
      id: 'suspended',
      title: 'Suspended',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
    },
    {
      id: 'recoveryEmail',
      title: 'Recovery Email',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'personal@example.com',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
    },
    {
      id: 'recoveryPhone',
      title: 'Recovery Phone',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '+16505551212',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
    },
    {
      id: 'alias',
      title: 'Alias Email',
      type: 'short-input',
      placeholder: 'alias@example.com',
      required: true,
      condition: { field: 'operation', value: ['add_user_alias', 'remove_user_alias'] },
    },
    {
      id: 'clientId',
      title: 'Application Client ID',
      type: 'short-input',
      placeholder: 'OAuth client ID from List User Tokens',
      required: true,
      condition: { field: 'operation', value: 'revoke_user_token' },
    },

    {
      id: 'orgUnitPath',
      title: 'Org Unit Path',
      type: 'short-input',
      placeholder: '/Sales/West',
      required: { field: 'operation', value: [...ORG_UNIT_PATH_REQUIRED_OPERATIONS] },
      condition: { field: 'operation', value: [...ORG_UNIT_PATH_OPERATIONS] },
    },
    {
      id: 'name',
      title: 'Org Unit Name',
      type: 'short-input',
      placeholder: 'West',
      required: { field: 'operation', value: 'create_org_unit' },
      condition: { field: 'operation', value: ['create_org_unit', 'update_org_unit'] },
    },
    {
      id: 'parentOrgUnitPath',
      title: 'Parent Org Unit Path',
      type: 'short-input',
      placeholder: '/Sales',
      required: { field: 'operation', value: 'create_org_unit' },
      condition: { field: 'operation', value: ['create_org_unit', 'update_org_unit'] },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'What this org unit is for',
      condition: { field: 'operation', value: ['create_org_unit', 'update_org_unit'] },
    },
    {
      id: 'orgUnitType',
      title: 'Include',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { id: 'CHILDREN', label: 'Immediate children' },
        { id: 'ALL', label: 'All descendants' },
        { id: 'ALL_INCLUDING_PARENT', label: 'All descendants and the parent' },
      ],
      condition: { field: 'operation', value: 'list_org_units' },
    },

    {
      id: 'roleId',
      title: 'Role ID',
      type: 'short-input',
      placeholder: 'Role ID from List Roles',
      required: { field: 'operation', value: ['get_role', 'create_role_assignment'] },
      condition: {
        field: 'operation',
        value: ['get_role', 'list_role_assignments', 'create_role_assignment'],
      },
    },
    {
      id: 'assignedTo',
      title: 'Assign To (User or Group ID)',
      type: 'short-input',
      placeholder: 'Unique directory ID, not an email address',
      required: true,
      condition: { field: 'operation', value: 'create_role_assignment' },
    },
    {
      id: 'scopeType',
      title: 'Scope',
      type: 'dropdown',
      options: [
        { id: 'CUSTOMER', label: 'Whole account' },
        { id: 'ORG_UNIT', label: 'One org unit' },
      ],
      condition: { field: 'operation', value: 'create_role_assignment' },
    },
    {
      id: 'orgUnitId',
      title: 'Org Unit ID',
      type: 'short-input',
      placeholder: 'Org unit ID when the scope is one org unit',
      condition: { field: 'operation', value: 'create_role_assignment' },
    },
    {
      id: 'roleAssignmentId',
      title: 'Role Assignment ID',
      type: 'short-input',
      placeholder: 'ID from List Role Assignments',
      required: true,
      condition: { field: 'operation', value: 'delete_role_assignment' },
    },
    {
      id: 'includeIndirectRoleAssignments',
      title: 'Include Roles Inherited From Groups',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_role_assignments' },
    },

    {
      id: 'resourceId',
      title: 'Mobile Device Resource ID',
      type: 'short-input',
      placeholder: 'Resource ID from List Mobile Devices',
      required: true,
      condition: { field: 'operation', value: ['get_mobile_device', 'action_mobile_device'] },
    },
    {
      id: 'action',
      title: 'Device Action',
      type: 'dropdown',
      required: true,
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'block', label: 'Block' },
        { id: 'admin_account_wipe', label: 'Wipe account data only' },
        { id: 'admin_remote_wipe', label: 'Wipe entire device' },
        { id: 'cancel_remote_wipe_then_activate', label: 'Cancel wipe, then activate' },
        { id: 'cancel_remote_wipe_then_block', label: 'Cancel wipe, then block' },
      ],
      condition: { field: 'operation', value: 'action_mobile_device' },
    },
    {
      id: 'deviceId',
      title: 'ChromeOS Device ID',
      type: 'short-input',
      placeholder: 'Device ID from List ChromeOS Devices',
      required: true,
      condition: { field: 'operation', value: ['get_chromeos_device', 'update_chromeos_device'] },
    },
    {
      id: 'annotatedUser',
      title: 'Assigned User',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: { field: 'operation', value: 'update_chromeos_device' },
    },
    {
      id: 'annotatedLocation',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Building 3, Floor 2',
      condition: { field: 'operation', value: 'update_chromeos_device' },
    },
    {
      id: 'annotatedAssetId',
      title: 'Asset ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Internal asset tag',
      condition: { field: 'operation', value: 'update_chromeos_device' },
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      mode: 'advanced',
      placeholder: 'Administrator notes about this device',
      condition: { field: 'operation', value: 'update_chromeos_device' },
    },
    {
      id: 'includeChildOrgunits',
      title: 'Include Child Org Units',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_chromeos_devices' },
    },

    {
      id: 'applicationName',
      title: 'Audit Log',
      type: 'dropdown',
      required: true,
      options: [
        { id: 'login', label: 'Login' },
        { id: 'admin', label: 'Admin' },
        { id: 'drive', label: 'Drive' },
        { id: 'token', label: 'Token' },
        { id: 'groups', label: 'Groups' },
        { id: 'mobile', label: 'Mobile' },
        { id: 'saml', label: 'SAML' },
        { id: 'user_accounts', label: 'User Accounts' },
        { id: 'chrome', label: 'Chrome' },
        { id: 'meet', label: 'Meet' },
        { id: 'calendar', label: 'Calendar' },
        { id: 'chat', label: 'Chat' },
        { id: 'gmail', label: 'Gmail' },
        { id: 'rules', label: 'Rules' },
        { id: 'context_aware_access', label: 'Context-Aware Access' },
      ],
      condition: { field: 'operation', value: 'list_activities' },
    },
    {
      id: 'eventName',
      title: 'Event Name',
      type: 'short-input',
      placeholder: 'login_failure',
      condition: { field: 'operation', value: 'list_activities' },
    },
    {
      id: 'actorIpAddress',
      title: 'Actor IP Address',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '203.0.113.10',
      condition: { field: 'operation', value: 'list_activities' },
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '2026-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'list_activities' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an RFC 3339 timestamp for the start of the requested range. Return ONLY the timestamp string.',
        generationType: 'timestamp',
        placeholder: 'Describe when the range should start...',
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '2026-01-31T23:59:59Z',
      condition: { field: 'operation', value: 'list_activities' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an RFC 3339 timestamp for the end of the requested range. Return ONLY the timestamp string.',
        generationType: 'timestamp',
        placeholder: 'Describe when the range should end...',
      },
    },
    {
      id: 'date',
      title: 'Report Date',
      type: 'short-input',
      placeholder: '2026-01-15',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_customer_usage_report', 'get_user_usage_report'],
      },
    },
    {
      id: 'parameters',
      title: 'Report Parameters',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'accounts:num_users,gmail:num_emails_sent',
      condition: {
        field: 'operation',
        value: ['get_customer_usage_report', 'get_user_usage_report'],
      },
    },
    {
      id: 'filters',
      title: 'Filters',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'doc_id==12345',
      condition: { field: 'operation', value: ['list_activities', 'get_user_usage_report'] },
    },
    {
      id: 'orgUnitID',
      title: 'Org Unit ID Filter',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Org unit ID',
      condition: { field: 'operation', value: ['list_activities', 'get_user_usage_report'] },
    },
    {
      id: 'groupIdFilter',
      title: 'Group ID Filter',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Comma-separated obfuscated group IDs',
      condition: { field: 'operation', value: ['list_activities', 'get_user_usage_report'] },
    },

    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'orgUnitPath=/Sales',
      condition: {
        field: 'operation',
        value: ['list_users', 'list_mobile_devices', 'list_chromeos_devices'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google Admin SDK Directory search query from the user's description.

Directory user query syntax:
- email:pattern* — match a user's email address (wildcards allowed)
- givenName:term / familyName:term — match a name
- orgUnitPath=/Path — restrict to an org unit
- isAdmin=true — only super administrators
- isSuspended=true — only suspended accounts

Device query syntax:
- email:user@example.com, model:Pixel, os:Android (mobile devices)
- user:user@example.com, status:provisioned, asset_id:1234 (ChromeOS devices)

Return ONLY the query string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe what you want to find...',
      },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: [...MAX_RESULTS_OPERATIONS] },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Token from a previous page',
      condition: { field: 'operation', value: [...PAGINATED_OPERATIONS] },
    },
    {
      id: 'orderBy',
      title: 'Sort By',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'EMAIL, LAST_SYNC, SERIAL_NUMBER, ...',
      condition: {
        field: 'operation',
        value: ['list_users', 'list_mobile_devices', 'list_chromeos_devices'],
      },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { id: 'ASCENDING', label: 'Ascending' },
        { id: 'DESCENDING', label: 'Descending' },
      ],
      condition: {
        field: 'operation',
        value: ['list_users', 'list_mobile_devices', 'list_chromeos_devices'],
      },
    },
    {
      id: 'projection',
      title: 'Detail Level',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'BASIC, CUSTOM, or FULL',
      condition: {
        field: 'operation',
        value: [
          'list_users',
          'get_user',
          'list_mobile_devices',
          'get_mobile_device',
          'list_chromeos_devices',
          'get_chromeos_device',
        ],
      },
    },
    {
      id: 'viewType',
      title: 'View Type',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { id: 'admin_view', label: 'Admin view' },
        { id: 'domain_public', label: 'Domain public view' },
      ],
      condition: { field: 'operation', value: ['list_users', 'get_user'] },
    },
    {
      id: 'showDeleted',
      title: 'Show Deleted Users',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'customerId',
      title: 'Customer ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'my_customer (default)',
      condition: { field: 'operation', value: [...CUSTOMER_OPERATIONS] },
    },
  ],
  tools: {
    access: [
      'google_workspace_admin_list_users',
      'google_workspace_admin_get_user',
      'google_workspace_admin_create_user',
      'google_workspace_admin_update_user',
      'google_workspace_admin_delete_user',
      'google_workspace_admin_suspend_user',
      'google_workspace_admin_unsuspend_user',
      'google_workspace_admin_reset_password',
      'google_workspace_admin_move_user_org_unit',
      'google_workspace_admin_make_admin',
      'google_workspace_admin_revoke_admin',
      'google_workspace_admin_sign_out_user',
      'google_workspace_admin_list_user_aliases',
      'google_workspace_admin_add_user_alias',
      'google_workspace_admin_remove_user_alias',
      'google_workspace_admin_list_user_tokens',
      'google_workspace_admin_revoke_user_token',
      'google_workspace_admin_list_org_units',
      'google_workspace_admin_get_org_unit',
      'google_workspace_admin_create_org_unit',
      'google_workspace_admin_update_org_unit',
      'google_workspace_admin_delete_org_unit',
      'google_workspace_admin_list_roles',
      'google_workspace_admin_get_role',
      'google_workspace_admin_list_role_assignments',
      'google_workspace_admin_create_role_assignment',
      'google_workspace_admin_delete_role_assignment',
      'google_workspace_admin_list_mobile_devices',
      'google_workspace_admin_get_mobile_device',
      'google_workspace_admin_action_mobile_device',
      'google_workspace_admin_list_chromeos_devices',
      'google_workspace_admin_get_chromeos_device',
      'google_workspace_admin_update_chromeos_device',
      'google_workspace_admin_list_activities',
      'google_workspace_admin_get_customer_usage_report',
      'google_workspace_admin_get_user_usage_report',
    ],
    config: {
      tool: (params) => {
        const operation = String(params.operation)
        if (!SUPPORTED_OPERATIONS.has(operation)) {
          throw new Error(`Invalid Google Workspace Admin operation: ${operation}`)
        }
        return `google_workspace_admin_${operation}`
      },
      params: (params) => {
        const { oauthCredential, operation, ...rest } = params

        switch (operation) {
          case 'list_users':
            return {
              oauthCredential,
              customer: rest.customerId,
              domain: rest.domain,
              query: rest.query,
              maxResults: toNumber(rest.maxResults),
              pageToken: rest.pageToken,
              orderBy: rest.orderBy,
              sortOrder: rest.sortOrder,
              projection: rest.projection,
              viewType: rest.viewType,
              showDeleted: toBoolean(rest.showDeleted),
            }
          case 'get_user':
            return {
              oauthCredential,
              userKey: rest.userKey,
              projection: rest.projection,
              viewType: rest.viewType,
            }
          case 'create_user':
            return {
              oauthCredential,
              primaryEmail: rest.primaryEmail,
              givenName: rest.givenName,
              familyName: rest.familyName,
              password: rest.password,
              changePasswordAtNextLogin: toBoolean(rest.changePasswordAtNextLogin),
              orgUnitPath: rest.orgUnitPath,
              suspended: toBoolean(rest.suspended),
              recoveryEmail: rest.recoveryEmail,
              recoveryPhone: rest.recoveryPhone,
            }
          case 'update_user':
            return {
              oauthCredential,
              userKey: rest.userKey,
              primaryEmail: rest.primaryEmail,
              givenName: rest.givenName,
              familyName: rest.familyName,
              orgUnitPath: rest.orgUnitPath,
              suspended: toBoolean(rest.suspended),
              recoveryEmail: rest.recoveryEmail,
              recoveryPhone: rest.recoveryPhone,
            }
          case 'delete_user':
          case 'suspend_user':
          case 'unsuspend_user':
          case 'make_admin':
          case 'revoke_admin':
          case 'sign_out_user':
          case 'list_user_aliases':
          case 'list_user_tokens':
            return { oauthCredential, userKey: rest.userKey }
          case 'reset_password':
            return {
              oauthCredential,
              userKey: rest.userKey,
              password: rest.password,
              changePasswordAtNextLogin: toBoolean(rest.changePasswordAtNextLogin),
              hashFunction: rest.hashFunction,
            }
          case 'move_user_org_unit':
            return {
              oauthCredential,
              userKey: rest.userKey,
              orgUnitPath: rest.orgUnitPath,
            }
          case 'add_user_alias':
          case 'remove_user_alias':
            return { oauthCredential, userKey: rest.userKey, alias: rest.alias }
          case 'revoke_user_token':
            return { oauthCredential, userKey: rest.userKey, clientId: rest.clientId }
          case 'list_org_units':
            return {
              oauthCredential,
              customerId: rest.customerId,
              orgUnitPath: rest.orgUnitPath,
              type: rest.orgUnitType,
            }
          case 'get_org_unit':
          case 'delete_org_unit':
            return {
              oauthCredential,
              customerId: rest.customerId,
              orgUnitPath: rest.orgUnitPath,
            }
          case 'create_org_unit':
            return {
              oauthCredential,
              customerId: rest.customerId,
              name: rest.name,
              parentOrgUnitPath: rest.parentOrgUnitPath,
              description: rest.description,
            }
          case 'update_org_unit':
            return {
              oauthCredential,
              customerId: rest.customerId,
              orgUnitPath: rest.orgUnitPath,
              name: rest.name,
              parentOrgUnitPath: rest.parentOrgUnitPath,
              description: rest.description,
            }
          case 'list_roles':
            return {
              oauthCredential,
              customer: rest.customerId,
              maxResults: toNumber(rest.maxResults),
              pageToken: rest.pageToken,
            }
          case 'get_role':
            return { oauthCredential, customer: rest.customerId, roleId: rest.roleId }
          case 'list_role_assignments':
            return {
              oauthCredential,
              customer: rest.customerId,
              roleId: rest.roleId,
              userKey: rest.userKey,
              includeIndirectRoleAssignments: toBoolean(rest.includeIndirectRoleAssignments),
              maxResults: toNumber(rest.maxResults),
              pageToken: rest.pageToken,
            }
          case 'create_role_assignment':
            return {
              oauthCredential,
              customer: rest.customerId,
              roleId: rest.roleId,
              assignedTo: rest.assignedTo,
              scopeType: rest.scopeType,
              orgUnitId: rest.orgUnitId,
            }
          case 'delete_role_assignment':
            return {
              oauthCredential,
              customer: rest.customerId,
              roleAssignmentId: rest.roleAssignmentId,
            }
          case 'list_mobile_devices':
            return {
              oauthCredential,
              customerId: rest.customerId,
              query: rest.query,
              maxResults: toNumber(rest.maxResults),
              pageToken: rest.pageToken,
              orderBy: rest.orderBy,
              sortOrder: rest.sortOrder,
              projection: rest.projection,
            }
          case 'get_mobile_device':
            return {
              oauthCredential,
              customerId: rest.customerId,
              resourceId: rest.resourceId,
              projection: rest.projection,
            }
          case 'action_mobile_device':
            return {
              oauthCredential,
              customerId: rest.customerId,
              resourceId: rest.resourceId,
              action: rest.action,
            }
          case 'list_chromeos_devices':
            return {
              oauthCredential,
              customerId: rest.customerId,
              orgUnitPath: rest.orgUnitPath,
              query: rest.query,
              maxResults: toNumber(rest.maxResults),
              pageToken: rest.pageToken,
              orderBy: rest.orderBy,
              sortOrder: rest.sortOrder,
              projection: rest.projection,
              includeChildOrgunits: toBoolean(rest.includeChildOrgunits),
            }
          case 'get_chromeos_device':
            return {
              oauthCredential,
              customerId: rest.customerId,
              deviceId: rest.deviceId,
              projection: rest.projection,
            }
          case 'update_chromeos_device':
            return {
              oauthCredential,
              customerId: rest.customerId,
              deviceId: rest.deviceId,
              annotatedUser: rest.annotatedUser,
              annotatedLocation: rest.annotatedLocation,
              annotatedAssetId: rest.annotatedAssetId,
              notes: rest.notes,
              orgUnitPath: rest.orgUnitPath,
            }
          case 'list_activities':
            return {
              oauthCredential,
              applicationName: rest.applicationName,
              userKey: rest.userKey,
              eventName: rest.eventName,
              actorIpAddress: rest.actorIpAddress,
              startTime: rest.startTime,
              endTime: rest.endTime,
              filters: rest.filters,
              orgUnitID: rest.orgUnitID,
              groupIdFilter: rest.groupIdFilter,
              maxResults: toNumber(rest.maxResults),
              pageToken: rest.pageToken,
            }
          case 'get_customer_usage_report':
            return {
              oauthCredential,
              date: rest.date,
              customerId: rest.customerId,
              parameters: rest.parameters,
              pageToken: rest.pageToken,
            }
          case 'get_user_usage_report':
            return {
              oauthCredential,
              date: rest.date,
              userKey: rest.userKey,
              customerId: rest.customerId,
              parameters: rest.parameters,
              filters: rest.filters,
              orgUnitID: rest.orgUnitID,
              groupIdFilter: rest.groupIdFilter,
              maxResults: toNumber(rest.maxResults),
              pageToken: rest.pageToken,
            }
          default:
            return { oauthCredential, ...rest }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Workspace admin OAuth credential' },
    customerId: { type: 'string', description: 'Customer ID, or my_customer' },
    userKey: { type: 'string', description: 'User email address, alias, or unique ID' },
    primaryEmail: { type: 'string', description: 'Primary email address of the user' },
    givenName: { type: 'string', description: 'First name of the user' },
    familyName: { type: 'string', description: 'Last name of the user' },
    password: { type: 'string', description: 'Password to set on the account' },
    changePasswordAtNextLogin: {
      type: 'boolean',
      description: 'Force a password change at next sign-in',
    },
    hashFunction: { type: 'string', description: 'Hash format of the supplied password' },
    suspended: { type: 'boolean', description: 'Suspended state of the account' },
    recoveryEmail: { type: 'string', description: 'Recovery email address' },
    recoveryPhone: { type: 'string', description: 'Recovery phone number' },
    alias: { type: 'string', description: 'Alias email address' },
    clientId: { type: 'string', description: 'OAuth client ID of an authorized application' },
    orgUnitPath: { type: 'string', description: 'Org unit path' },
    name: { type: 'string', description: 'Org unit name' },
    parentOrgUnitPath: { type: 'string', description: 'Parent org unit path' },
    description: { type: 'string', description: 'Org unit description' },
    orgUnitType: { type: 'string', description: 'Which org units to include when listing' },
    roleId: { type: 'string', description: 'Admin role ID' },
    assignedTo: { type: 'string', description: 'Unique ID of the role assignee' },
    scopeType: { type: 'string', description: 'Scope of a role assignment' },
    orgUnitId: { type: 'string', description: 'Org unit ID for an org-unit-scoped assignment' },
    roleAssignmentId: { type: 'string', description: 'Role assignment ID' },
    includeIndirectRoleAssignments: {
      type: 'boolean',
      description: 'Include roles inherited through groups',
    },
    resourceId: { type: 'string', description: 'Mobile device resource ID' },
    action: { type: 'string', description: 'Mobile device action to run' },
    deviceId: { type: 'string', description: 'ChromeOS device ID' },
    annotatedUser: { type: 'string', description: 'User assigned to a ChromeOS device' },
    annotatedLocation: { type: 'string', description: 'Location of a ChromeOS device' },
    annotatedAssetId: { type: 'string', description: 'Asset ID of a ChromeOS device' },
    notes: { type: 'string', description: 'Administrator notes on a ChromeOS device' },
    includeChildOrgunits: { type: 'boolean', description: 'Include nested org units when listing' },
    applicationName: { type: 'string', description: 'Audit log to read' },
    eventName: { type: 'string', description: 'Audit event name filter' },
    actorIpAddress: { type: 'string', description: 'Actor IP address filter' },
    startTime: { type: 'string', description: 'Oldest activity to return' },
    endTime: { type: 'string', description: 'Newest activity to return' },
    date: { type: 'string', description: 'Day a usage report covers, as yyyy-mm-dd' },
    parameters: { type: 'string', description: 'Usage report parameters to return' },
    filters: { type: 'string', description: 'Parameter conditions used to filter results' },
    orgUnitID: { type: 'string', description: 'Org unit ID filter' },
    groupIdFilter: { type: 'string', description: 'Obfuscated group ID filter' },
    domain: { type: 'string', description: 'Domain to list users from' },
    query: { type: 'string', description: 'Directory or device search query' },
    maxResults: { type: 'number', description: 'Maximum number of results to return' },
    pageToken: { type: 'string', description: 'Token for fetching the next page' },
    orderBy: { type: 'string', description: 'Field to sort results by' },
    sortOrder: { type: 'string', description: 'Sort direction' },
    projection: { type: 'string', description: 'Level of detail to return' },
    viewType: { type: 'string', description: 'Admin or domain-public view of a user' },
    showDeleted: { type: 'boolean', description: 'Return recently deleted users' },
  },
  outputs: {
    users: { type: 'json', description: 'Array of User resources (for list_users)' },
    user: { type: 'json', description: 'Single User resource' },
    aliases: { type: 'json', description: 'Array of UserAlias resources' },
    alias: { type: 'json', description: 'Single UserAlias resource' },
    tokens: { type: 'json', description: 'Array of Token resources' },
    organizationUnits: { type: 'json', description: 'Array of OrgUnit resources' },
    orgUnit: { type: 'json', description: 'Single OrgUnit resource' },
    roles: { type: 'json', description: 'Array of Role resources' },
    role: { type: 'json', description: 'Single Role resource' },
    roleAssignments: { type: 'json', description: 'Array of RoleAssignment resources' },
    roleAssignment: { type: 'json', description: 'Single RoleAssignment resource' },
    mobileDevices: { type: 'json', description: 'Array of MobileDevice resources' },
    mobileDevice: { type: 'json', description: 'Single MobileDevice resource' },
    chromeOsDevices: { type: 'json', description: 'Array of ChromeOsDevice resources' },
    chromeOsDevice: { type: 'json', description: 'Single ChromeOsDevice resource' },
    activities: { type: 'json', description: 'Array of audit Activity resources' },
    usageReports: { type: 'json', description: 'Array of UsageReport resources' },
    warnings: { type: 'json', description: 'Warnings returned alongside a usage report' },
    message: { type: 'string', description: 'Confirmation message for empty-body operations' },
    nextPageToken: { type: 'string', description: 'Token for fetching the next page of results' },
  },
}

export const GoogleWorkspaceAdminBlockMeta = {
  tags: ['google-workspace', 'identity', 'automation'],
  url: 'https://admin.google.com',
  templates: [
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace onboarding',
      prompt:
        'Build a workflow that watches Rippling for new hires, creates their Google Workspace account with a temporary password and a forced password change, places them in the org unit for their department, and posts the account details to their manager in Slack.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['rippling', 'slack'],
    },
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace offboarding',
      prompt:
        'Create a workflow that watches Workday for terminations, then suspends the Google Workspace account, signs the user out of every session, revokes the application tokens they issued, and moves them into a Departed org unit.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace admin-role review',
      prompt:
        'Build a scheduled workflow that lists every Google Workspace admin role assignment each quarter, writes the holders and their scopes to a table, and asks each role owner in Slack to confirm the access is still needed.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace failed-login watch',
      prompt:
        'Create a scheduled workflow that reads the Google Workspace login audit log every hour, groups failed sign-ins by user and IP address, and pages the security team in PagerDuty when a single account crosses a threshold.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'incident-management'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace department transfer',
      prompt:
        'Build a workflow that takes a department transfer request from a form, moves the Google Workspace user into the destination org unit, updates their profile name fields if they changed, and confirms the move in Slack.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace lost-device response',
      prompt:
        'Create a workflow that takes a lost-device report, finds the matching mobile device in Google Workspace, blocks it, wipes only the corporate account data, and records the action in a security audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace third-party app audit',
      prompt:
        'Build a scheduled workflow that lists every Google Workspace user, reads the application tokens each of them has issued, flags apps holding broad scopes against an allowlist, and posts the findings to the security team in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace dormant-account cleanup',
      prompt:
        'Create a scheduled workflow that reads the Google Workspace user usage report, finds accounts with no sign-in for ninety days, asks their manager in Slack whether to keep them, and suspends the ones nobody claims.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleWorkspaceAdminIcon,
      title: 'Google Workspace ChromeOS inventory',
      prompt:
        'Build a scheduled workflow that lists every enrolled ChromeOS device, writes the serial number, assigned user, location, and last sync time to a table, and flags devices that have not synced in thirty days.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'onboard-workspace-user',
      description:
        'Create a Google Workspace account for a new hire and place them in the right org unit.',
      content:
        '# Onboard a Workspace User\n\nStand up an account for a new hire.\n\n## Steps\n1. Collect the primary email address, first name, last name, and the department org unit path.\n2. Run List Org Units to confirm the destination org unit path exists.\n3. Run Create User with the email, names, a temporary password, the org unit path, and Change Password At Next Sign-In enabled.\n4. Optionally run Add User Alias for any additional addresses the person needs.\n\n## Output\nConfirm the created account, the org unit it landed in, and whether a password change is forced. Never echo the temporary password into a shared channel.',
    },
    {
      name: 'offboard-workspace-user',
      description:
        'Suspend a departing Google Workspace user and cut off their active sessions and app access.',
      content:
        "# Offboard a Workspace User\n\nRevoke a departing employee's access without deleting their data.\n\n## Steps\n1. Run Get User to confirm the account exists and note whether they hold admin privileges.\n2. If they are a super administrator, run Revoke Admin first.\n3. Run Suspend User to block sign-in.\n4. Run Sign Out User to terminate every live session.\n5. Run List User Tokens, then Revoke User Token for each third-party application.\n6. Optionally run Move User Org Unit to a Departed org unit so leaver policies apply.\n\n## Output\nList each step taken and its result, including every application whose tokens were revoked. Note that suspension preserves data, while Delete User is separate and irreversible.",
    },
    {
      name: 'audit-admin-roles',
      description:
        'Report who holds Google Workspace administrator roles and at what scope, for access review.',
      content:
        '# Audit Admin Roles\n\nProduce a roster of privileged access.\n\n## Steps\n1. Run List Roles to get every role ID, name, and whether it is a super admin role.\n2. Run List Role Assignments, paging through the next page token until complete. Enable Include Roles Inherited From Groups to catch indirect access.\n3. Join each assignment to its role, and resolve the assignee ID to a person with Get User where useful.\n4. Separate super admin holders from delegated-role holders, and note which assignments are scoped to a single org unit.\n\n## Output\nA roster grouped by role, with each holder, the scope (whole account or one org unit), and whether the access is direct or inherited. Call out super admin holders first.',
    },
    {
      name: 'respond-to-lost-device',
      description: 'Block and wipe a lost or stolen device enrolled in Google Workspace.',
      content:
        '# Respond to a Lost Device\n\nCut off a device that the owner no longer holds.\n\n## Steps\n1. Run List Mobile Devices with a query for the owner (e.g. "email:jane@example.com") to find the resource ID.\n2. Confirm the model, OS, and last sync time match the reported device.\n3. Run Action Mobile Device with `block` to stop it syncing immediately.\n4. Choose the wipe scope: `admin_account_wipe` erases only the Workspace account data; `admin_remote_wipe` erases the whole device. Prefer the account wipe on personally owned devices.\n5. If the device is recovered, run Action Mobile Device with `cancel_remote_wipe_then_activate`.\n\n## Output\nName the device acted on, the action taken, and the scope of any wipe. Wipes cannot be undone once the device applies them, so state clearly which one was run.',
    },
  ],
} as const satisfies BlockMeta
