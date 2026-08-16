import { AzureIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { MicrosoftAdResponse } from '@/tools/microsoft_ad/types'

/** Operations that act on a single user and therefore require the User ID field. */
const USER_ID_OPERATIONS = [
  'get_user',
  'update_user',
  'delete_user',
  'assign_license',
  'list_user_licenses',
  'revoke_sign_in_sessions',
  'set_password',
  'reset_password',
  'list_authentication_methods',
  'list_user_app_role_assignments',
  'add_user_app_role_assignment',
  'remove_user_app_role_assignment',
  'list_user_devices',
]

/**
 * Per-user operations that page through an `@odata.nextLink`. The continuation URL already
 * addresses the user, so these are the only per-user operations that can run without a User ID,
 * and only when continuing from a previous page.
 */
const PAGED_USER_ID_OPERATIONS = ['list_user_app_role_assignments', 'list_user_devices']

/** Per-user operations that always require a User ID, whichever page is being fetched. */
const ALWAYS_USER_ID_OPERATIONS = USER_ID_OPERATIONS.filter(
  (operation) => !PAGED_USER_ID_OPERATIONS.includes(operation)
)

/** Operations that act on a single group and therefore require the Group ID field. */
const GROUP_ID_OPERATIONS = [
  'get_group',
  'update_group',
  'delete_group',
  'list_group_members',
  'add_group_member',
  'remove_group_member',
]

/**
 * Group operations that page through an `@odata.nextLink`. The continuation URL already
 * addresses the group, so these are the only group operations that can run without a Group ID,
 * and only when continuing from a previous page.
 */
const PAGED_GROUP_ID_OPERATIONS = ['list_group_members']

/** Group operations that always require a Group ID, whichever page is being fetched. */
const ALWAYS_GROUP_ID_OPERATIONS = GROUP_ID_OPERATIONS.filter(
  (operation) => !PAGED_GROUP_ID_OPERATIONS.includes(operation)
)

/** Collection operations that accept a page size and an @odata.nextLink continuation URL. */
const PAGED_OPERATIONS = [
  'list_users',
  'list_groups',
  'list_group_members',
  'list_sign_ins',
  'list_directory_audits',
  'list_user_app_role_assignments',
  'list_service_principals',
  'list_devices',
  'list_user_devices',
  'list_conditional_access_policies',
]

/**
 * Operations that return an `@odata.nextLink` continuation URL. This is a superset of
 * `PAGED_OPERATIONS`: `appRoleAssignedTo` pages through `@odata.nextLink` but the tool does not
 * expose a `$top` page size.
 */
const NEXT_LINK_OPERATIONS = [...PAGED_OPERATIONS, 'list_service_principal_app_role_assignments']

/** Operations that own the shared `filter` and `search` fields. */
const SHARED_FILTER_OPERATIONS = ['list_users', 'list_groups']

/**
 * The subBlock each operation reads its OData `$filter` from.
 *
 * A subBlock keeps its value after the operation changes, so the filter is resolved by
 * ownership rather than by letting later assignments overwrite earlier ones. Otherwise a clause
 * written for `/users` would still be sent when the block is switched to `/auditLogs/signIns` or
 * `/devices`, where it is invalid.
 *
 * The mapper must write `filter` and `search` on every operation, including as `undefined`. The
 * executor merges `{ ...inputs, ...transformedParams }`, so a key that is merely omitted here
 * leaves the stale serialized value in place rather than clearing it. The same applies to every
 * optional field the mapper coerces out of a subBlock string, such as
 * `forceChangePasswordNextSignInWithMfa`: omitting the key on "No Change" would forward the raw
 * empty string to Graph in place of a boolean.
 */
const FILTER_FIELD_BY_OPERATION: Record<string, string> = {
  list_users: 'filter',
  list_groups: 'filter',
  list_sign_ins: 'signInFilter',
  list_directory_audits: 'auditFilter',
  list_user_app_role_assignments: 'appRoleFilter',
  list_service_principal_app_role_assignments: 'appRoleFilter',
  list_service_principals: 'servicePrincipalFilter',
  list_devices: 'deviceFilter',
  list_conditional_access_policies: 'policyFilter',
}

/** The subBlock each operation reads its `$search` term from. */
const SEARCH_FIELD_BY_OPERATION: Record<string, string> = {
  list_users: 'search',
  list_groups: 'search',
  list_service_principals: 'servicePrincipalSearch',
  list_devices: 'deviceSearch',
}

/** Operations that act on a single device object. */
const DEVICE_ID_OPERATIONS = ['get_device']

/** Operations that act on a single directory role. */
const DIRECTORY_ROLE_OPERATIONS = [
  'list_directory_role_members',
  'add_directory_role_member',
  'remove_directory_role_member',
]

export const MicrosoftAdBlock: BlockConfig<MicrosoftAdResponse> = {
  type: 'microsoft_ad',
  name: 'Azure AD',
  description: 'Manage identities, licenses, roles, and access in Azure AD (Microsoft Entra ID)',
  longDescription:
    'Integrate Azure Active Directory into your workflows. Create, update, and delete users and groups, manage group memberships, assign and remove licenses, reset passwords, revoke sign-in sessions, read sign-in and directory audit logs, grant and revoke app and directory roles, and read registered devices and conditional access policies. Device writes are not supported.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_ad',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#0078D4',
  icon: AzureIcon,
  canvasPresentation: {
    defaultTitle: 'Azure AD',
    sentences: {
      byOperation: {
        list_users: [
          'List users',
          { text: ', matching', field: 'search' },
          { text: ', where', field: 'filter' },
        ],
        get_user: [{ text: 'Fetch user', field: 'userId', core: true }],
        create_user: [
          { text: 'Create user', field: 'displayName', core: true },
          { text: ', signing in as', field: 'userPrincipalName' },
        ],
        update_user: [
          { text: 'Update user', field: 'userId', core: true },
          { text: ', renaming them to', field: 'displayName' },
        ],
        delete_user: [{ text: 'Delete user', field: 'userId', core: true }],
        list_groups: [
          'List groups',
          { text: ', matching', field: 'search' },
          { text: ', where', field: 'filter' },
        ],
        get_group: [{ text: 'Fetch group', field: 'groupId', core: true }],
        create_group: [
          { text: 'Create group', field: 'groupDisplayName', core: true },
          { text: ', as a', field: 'groupTypes' },
        ],
        update_group: [
          { text: 'Update group', field: 'groupId', core: true },
          { text: ', renaming it to', field: 'groupDisplayName' },
        ],
        delete_group: [{ text: 'Delete group', field: 'groupId', core: true }],
        list_group_members: [{ text: 'List members of group', field: 'groupId', core: true }],
        add_group_member: [
          { text: 'Add member', field: 'memberId', core: true },
          { text: 'to group', field: 'groupId', core: true },
        ],
        remove_group_member: [
          { text: 'Remove member', field: 'memberId', core: true },
          { text: 'from group', field: 'groupId', core: true },
        ],
        assign_license: [
          { text: 'Change licenses for', field: 'userId', core: true },
          { text: ', adding', field: 'addSkuIds' },
          { text: ', removing', field: 'removeSkuIds' },
        ],
        list_user_licenses: [{ text: 'List licenses for user', field: 'userId', core: true }],
        list_subscribed_skus: ['List tenant subscription SKUs'],
        revoke_sign_in_sessions: [
          { text: 'Revoke sign-in sessions for', field: 'userId', core: true },
        ],
        set_password: [{ text: 'Set the password for user', field: 'userId', core: true }],
        reset_password: [{ text: 'Reset the password for user', field: 'userId', core: true }],
        list_authentication_methods: [
          { text: 'List authentication methods for user', field: 'userId', core: true },
        ],
        list_sign_ins: ['List sign-ins', { text: ', where', field: 'signInFilter' }],
        list_directory_audits: ['List directory audits', { text: ', where', field: 'auditFilter' }],
        list_user_app_role_assignments: [
          { text: 'List app role assignments for user', field: 'userId', core: true },
        ],
        add_user_app_role_assignment: [
          { text: 'Grant app role', field: 'appRoleId', core: true },
          { text: 'to user', field: 'userId', core: true },
        ],
        remove_user_app_role_assignment: [
          { text: 'Revoke app role assignment', field: 'appRoleAssignmentId', core: true },
          { text: 'from user', field: 'userId', core: true },
        ],
        list_service_principals: [
          'List service principals',
          { text: ', matching', field: 'servicePrincipalSearch' },
        ],
        list_service_principal_app_role_assignments: [
          { text: 'List assignments for application', field: 'servicePrincipalId', core: true },
        ],
        list_directory_roles: ['List directory roles'],
        list_directory_role_members: [
          { text: 'List members of directory role', field: 'directoryRoleId', core: true },
        ],
        add_directory_role_member: [
          { text: 'Grant directory role', field: 'directoryRoleId', core: true },
          { text: 'to', field: 'memberId', core: true },
        ],
        remove_directory_role_member: [
          { text: 'Revoke directory role', field: 'directoryRoleId', core: true },
          { text: 'from', field: 'memberId', core: true },
        ],
        list_devices: ['List devices', { text: ', matching', field: 'deviceSearch' }],
        get_device: [{ text: 'Fetch device', field: 'deviceObjectId', core: true }],
        list_user_devices: [
          { text: 'List devices for user', field: 'userId', core: true },
          { text: ', linked as', field: 'deviceRelationship' },
        ],
        list_conditional_access_policies: ['List conditional access policies'],
        get_conditional_access_policy: [
          { text: 'Fetch conditional access policy', field: 'policyId', core: true },
        ],
      },
    },
  },
  authMode: AuthMode.OAuth,
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
        { label: 'List Groups', id: 'list_groups' },
        { label: 'Get Group', id: 'get_group' },
        { label: 'Create Group', id: 'create_group' },
        { label: 'Update Group', id: 'update_group' },
        { label: 'Delete Group', id: 'delete_group' },
        { label: 'List Group Members', id: 'list_group_members' },
        { label: 'Add Group Member', id: 'add_group_member' },
        { label: 'Remove Group Member', id: 'remove_group_member' },
        { label: 'Assign License', id: 'assign_license' },
        { label: 'List User Licenses', id: 'list_user_licenses' },
        { label: 'List Subscribed SKUs', id: 'list_subscribed_skus' },
        { label: 'Revoke Sign-In Sessions', id: 'revoke_sign_in_sessions' },
        { label: 'Set Password', id: 'set_password' },
        { label: 'Reset Password', id: 'reset_password' },
        { label: 'List Authentication Methods', id: 'list_authentication_methods' },
        { label: 'List Sign-Ins', id: 'list_sign_ins' },
        { label: 'List Directory Audits', id: 'list_directory_audits' },
        { label: 'List User App Role Assignments', id: 'list_user_app_role_assignments' },
        { label: 'Grant App Role To User', id: 'add_user_app_role_assignment' },
        { label: 'Revoke App Role From User', id: 'remove_user_app_role_assignment' },
        { label: 'List Service Principals', id: 'list_service_principals' },
        {
          label: 'List Application Assignments',
          id: 'list_service_principal_app_role_assignments',
        },
        { label: 'List Directory Roles', id: 'list_directory_roles' },
        { label: 'List Directory Role Members', id: 'list_directory_role_members' },
        { label: 'Add Directory Role Member', id: 'add_directory_role_member' },
        { label: 'Remove Directory Role Member', id: 'remove_directory_role_member' },
        { label: 'List Devices', id: 'list_devices' },
        { label: 'Get Device', id: 'get_device' },
        { label: 'List User Devices', id: 'list_user_devices' },
        {
          label: 'List Conditional Access Policies',
          id: 'list_conditional_access_policies',
        },
        { label: 'Get Conditional Access Policy', id: 'get_conditional_access_policy' },
      ],
      value: () => 'list_users',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      serviceId: 'microsoft-ad',
      requiredScopes: getScopesForService('microsoft-ad'),
      required: true,
    },
    // User ID field (for get, update, delete user)
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'User ID or user principal name (e.g., user@example.com)',
      condition: { field: 'operation', value: USER_ID_OPERATIONS },
      required: (values) =>
        values?.nextLink
          ? { field: 'operation', value: ALWAYS_USER_ID_OPERATIONS }
          : { field: 'operation', value: USER_ID_OPERATIONS },
    },
    // Create user fields
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'e.g., John Doe',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      required: { field: 'operation', value: 'create_user' },
    },
    {
      id: 'mailNickname',
      title: 'Mail Nickname',
      type: 'short-input',
      placeholder: 'e.g., johndoe',
      condition: { field: 'operation', value: 'create_user' },
      required: { field: 'operation', value: 'create_user' },
    },
    {
      id: 'userPrincipalName',
      title: 'User Principal Name',
      type: 'short-input',
      placeholder: 'e.g., johndoe@example.com',
      condition: { field: 'operation', value: 'create_user' },
      required: { field: 'operation', value: 'create_user' },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Initial password',
      condition: { field: 'operation', value: ['create_user', 'set_password'] },
      required: { field: 'operation', value: ['create_user', 'set_password'] },
      password: true,
    },
    {
      id: 'accountEnabled',
      title: 'Account Enabled',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_user' },
    },
    {
      id: 'accountEnabledCreate',
      title: 'Account Enabled',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_user' },
    },
    // Update user optional fields
    {
      id: 'givenName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'e.g., John',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'surname',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'e.g., Doe',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'jobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'e.g., Software Engineer',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'department',
      title: 'Department',
      type: 'short-input',
      placeholder: 'e.g., Engineering',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'officeLocation',
      title: 'Office Location',
      type: 'short-input',
      placeholder: 'e.g., Building A, Room 101',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    {
      id: 'mobilePhone',
      title: 'Mobile Phone',
      type: 'short-input',
      placeholder: 'e.g., +1-555-555-5555',
      condition: { field: 'operation', value: ['create_user', 'update_user'] },
      mode: 'advanced',
    },
    // List users/groups optional filters
    {
      id: 'top',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'e.g., 100 (max 999)',
      condition: { field: 'operation', value: PAGED_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: "e.g., department eq 'Sales'",
      condition: { field: 'operation', value: SHARED_FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search by name or email',
      condition: { field: 'operation', value: SHARED_FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'nextLink',
      title: 'Next Page',
      type: 'short-input',
      placeholder: "Paste the previous response's nextLink to fetch the next page",
      condition: { field: 'operation', value: NEXT_LINK_OPERATIONS },
      mode: 'advanced',
    },
    // Group ID field
    {
      id: 'groupId',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Group ID (GUID)',
      condition: { field: 'operation', value: GROUP_ID_OPERATIONS },
      /**
       * `list_group_members` pages through an `@odata.nextLink` that already addresses the
       * group, so it is the only member of this set that can run without a Group ID, and only
       * when continuing from a previous page.
       */
      required: (values) =>
        values?.nextLink
          ? { field: 'operation', value: ALWAYS_GROUP_ID_OPERATIONS }
          : { field: 'operation', value: GROUP_ID_OPERATIONS },
    },
    // Create group fields
    {
      id: 'groupDisplayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'e.g., Engineering Team',
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
      required: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'groupMailNickname',
      title: 'Mail Nickname',
      type: 'short-input',
      placeholder: 'e.g., engineering-team',
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
      required: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'groupDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Group description',
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
    },
    {
      id: 'mailEnabled',
      title: 'Mail Enabled',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'securityEnabled',
      title: 'Security Enabled',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'groupTypes',
      title: 'Group Type',
      type: 'dropdown',
      options: [
        { label: 'Security Group', id: '' },
        { label: 'Microsoft 365 Group', id: 'Unified' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_group' },
      mode: 'advanced',
    },
    {
      id: 'visibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Private', id: 'Private' },
        { label: 'Public', id: 'Public' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_group' },
      mode: 'advanced',
    },
    {
      id: 'visibilityCreate',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Private', id: 'Private' },
        { label: 'Public', id: 'Public' },
        { label: 'Hidden Membership (Microsoft 365 groups only)', id: 'HiddenMembership' },
      ],
      value: () => 'Private',
      condition: { field: 'operation', value: 'create_group' },
      mode: 'advanced',
    },
    // Member ID (for add/remove member)
    {
      id: 'memberId',
      title: 'Member ID',
      type: 'short-input',
      placeholder: 'User ID to add or remove',
      condition: {
        field: 'operation',
        value: [
          'add_group_member',
          'remove_group_member',
          'add_directory_role_member',
          'remove_directory_role_member',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'add_group_member',
          'remove_group_member',
          'add_directory_role_member',
          'remove_directory_role_member',
        ],
      },
    },
    {
      id: 'addSkuIds',
      title: 'Licenses To Add',
      type: 'short-input',
      placeholder: 'Comma-separated SKU IDs (GUIDs)',
      condition: { field: 'operation', value: 'assign_license' },
    },
    {
      id: 'removeSkuIds',
      title: 'Licenses To Remove',
      type: 'short-input',
      placeholder: 'Comma-separated SKU IDs (GUIDs)',
      condition: { field: 'operation', value: 'assign_license' },
    },
    {
      id: 'disabledPlanIds',
      title: 'Disabled Service Plans',
      type: 'short-input',
      placeholder: 'Comma-separated service plan IDs to disable on the added licenses',
      condition: { field: 'operation', value: 'assign_license' },
      mode: 'advanced',
    },
    {
      id: 'forceChangePasswordNextSignIn',
      title: 'Force Password Change At Next Sign-In',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'set_password' },
    },
    {
      id: 'forceChangePasswordNextSignInWithMfa',
      title: 'Require MFA Before Password Change',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'set_password' },
      mode: 'advanced',
    },
    {
      id: 'newPassword',
      title: 'New Password',
      type: 'short-input',
      placeholder: 'Leave empty to have Microsoft generate and return one',
      condition: { field: 'operation', value: 'reset_password' },
      password: true,
    },
    {
      id: 'signInFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'e.g., createdDateTime ge 2024-01-01T00:00:00Z and status/errorCode ne 0',
      condition: { field: 'operation', value: 'list_sign_ins' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Microsoft Graph OData $filter expression for the auditLogs/signIns endpoint. Filterable fields include userPrincipalName, userId, appId, appDisplayName, ipAddress, createdDateTime, conditionalAccessStatus, riskState and status/errorCode. Return ONLY the filter expression.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'auditFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'e.g., activityDateTime ge 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'list_directory_audits' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Microsoft Graph OData $filter expression for the auditLogs/directoryAudits endpoint. Filterable fields include activityDateTime, activityDisplayName, correlationId, loggedByService, initiatedBy and targetResources. Return ONLY the filter expression.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'appRoleFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: "e.g., resourceId eq '8e881353-1735-45af-af21-ee1344582a4d'",
      condition: {
        field: 'operation',
        value: ['list_user_app_role_assignments', 'list_service_principal_app_role_assignments'],
      },
      mode: 'advanced',
    },
    {
      id: 'resourceId',
      title: 'Service Principal ID',
      type: 'short-input',
      placeholder: 'Object ID of the service principal that defines the app role',
      condition: { field: 'operation', value: 'add_user_app_role_assignment' },
      required: { field: 'operation', value: 'add_user_app_role_assignment' },
    },
    {
      id: 'appRoleId',
      title: 'App Role ID',
      type: 'short-input',
      placeholder: 'App role GUID, or 00000000-0000-0000-0000-000000000000 for no specific role',
      condition: { field: 'operation', value: 'add_user_app_role_assignment' },
      required: { field: 'operation', value: 'add_user_app_role_assignment' },
    },
    {
      id: 'appRoleAssignmentId',
      title: 'App Role Assignment ID',
      type: 'short-input',
      placeholder: 'ID of the assignment to revoke',
      condition: { field: 'operation', value: 'remove_user_app_role_assignment' },
      required: { field: 'operation', value: 'remove_user_app_role_assignment' },
    },
    {
      id: 'servicePrincipalId',
      title: 'Service Principal ID',
      type: 'short-input',
      placeholder: 'Object ID of the service principal',
      condition: {
        field: 'operation',
        value: 'list_service_principal_app_role_assignments',
      },
      /**
       * The continuation URL already addresses the service principal, so the ID is only
       * required for the first page. An empty operation list matches nothing, which is how
       * the function form of `required` expresses "not required".
       */
      required: (values) =>
        values?.nextLink
          ? { field: 'operation', value: [] }
          : { field: 'operation', value: 'list_service_principal_app_role_assignments' },
    },
    {
      id: 'servicePrincipalSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search by application name',
      condition: { field: 'operation', value: 'list_service_principals' },
      mode: 'advanced',
    },
    {
      id: 'servicePrincipalFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: "e.g., servicePrincipalType eq 'Application'",
      condition: { field: 'operation', value: 'list_service_principals' },
      mode: 'advanced',
    },
    {
      id: 'directoryRoleId',
      title: 'Directory Role ID',
      type: 'short-input',
      placeholder: 'Object ID of the directory role',
      condition: { field: 'operation', value: DIRECTORY_ROLE_OPERATIONS },
      required: { field: 'operation', value: DIRECTORY_ROLE_OPERATIONS },
    },
    {
      id: 'deviceObjectId',
      title: 'Device Object ID',
      type: 'short-input',
      placeholder: 'Device object ID (not the deviceId registration identifier)',
      condition: { field: 'operation', value: DEVICE_ID_OPERATIONS },
      required: { field: 'operation', value: DEVICE_ID_OPERATIONS },
    },
    {
      id: 'deviceSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search by device name',
      condition: { field: 'operation', value: 'list_devices' },
      mode: 'advanced',
    },
    {
      id: 'deviceFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'e.g., accountEnabled eq false',
      condition: { field: 'operation', value: 'list_devices' },
      mode: 'advanced',
    },
    {
      id: 'deviceRelationship',
      title: 'Device Link',
      type: 'dropdown',
      options: [
        { label: 'Registered By User', id: 'registered' },
        { label: 'Owned By User', id: 'owned' },
      ],
      value: () => 'registered',
      condition: { field: 'operation', value: 'list_user_devices' },
    },
    {
      id: 'policyId',
      title: 'Policy ID',
      type: 'short-input',
      placeholder: 'Conditional access policy ID',
      condition: { field: 'operation', value: 'get_conditional_access_policy' },
      required: { field: 'operation', value: 'get_conditional_access_policy' },
    },
    {
      id: 'policyFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: "e.g., state eq 'enabled'",
      condition: { field: 'operation', value: 'list_conditional_access_policies' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'microsoft_ad_list_users',
      'microsoft_ad_get_user',
      'microsoft_ad_create_user',
      'microsoft_ad_update_user',
      'microsoft_ad_delete_user',
      'microsoft_ad_list_groups',
      'microsoft_ad_get_group',
      'microsoft_ad_create_group',
      'microsoft_ad_update_group',
      'microsoft_ad_delete_group',
      'microsoft_ad_list_group_members',
      'microsoft_ad_add_group_member',
      'microsoft_ad_remove_group_member',
      'microsoft_ad_assign_license',
      'microsoft_ad_list_user_licenses',
      'microsoft_ad_list_subscribed_skus',
      'microsoft_ad_revoke_sign_in_sessions',
      'microsoft_ad_set_password',
      'microsoft_ad_reset_password',
      'microsoft_ad_list_authentication_methods',
      'microsoft_ad_list_sign_ins',
      'microsoft_ad_list_directory_audits',
      'microsoft_ad_list_user_app_role_assignments',
      'microsoft_ad_add_user_app_role_assignment',
      'microsoft_ad_remove_user_app_role_assignment',
      'microsoft_ad_list_service_principals',
      'microsoft_ad_list_service_principal_app_role_assignments',
      'microsoft_ad_list_directory_roles',
      'microsoft_ad_list_directory_role_members',
      'microsoft_ad_add_directory_role_member',
      'microsoft_ad_remove_directory_role_member',
      'microsoft_ad_list_devices',
      'microsoft_ad_get_device',
      'microsoft_ad_list_user_devices',
      'microsoft_ad_list_conditional_access_policies',
      'microsoft_ad_get_conditional_access_policy',
    ],
    config: {
      tool: (params) => `microsoft_ad_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        const top = Number(params.top)
        result.top = params.top && Number.isFinite(top) ? top : undefined
        if (params.nextLink) result.nextLink = params.nextLink
        const values = params as Record<string, unknown>
        result.filter = values[FILTER_FIELD_BY_OPERATION[params.operation]] || undefined
        result.search = values[SEARCH_FIELD_BY_OPERATION[params.operation]] || undefined
        if (params.operation === 'set_password') {
          result.forceChangePasswordNextSignIn = params.forceChangePasswordNextSignIn !== 'false'
          result.forceChangePasswordNextSignInWithMfa = params.forceChangePasswordNextSignInWithMfa
            ? params.forceChangePasswordNextSignInWithMfa === 'true'
            : undefined
        }
        if (params.operation === 'update_user') {
          result.accountEnabled = params.accountEnabled
            ? params.accountEnabled === 'true'
            : undefined
        } else if (params.operation === 'create_user') {
          result.accountEnabled = params.accountEnabledCreate
            ? params.accountEnabledCreate === 'true'
            : undefined
        }
        if (params.mailEnabled !== undefined) result.mailEnabled = params.mailEnabled === 'true'
        if (params.securityEnabled !== undefined)
          result.securityEnabled = params.securityEnabled === 'true'
        // Map group-specific fields to tool param names
        if (params.groupDisplayName) result.displayName = params.groupDisplayName
        if (params.groupMailNickname) result.mailNickname = params.groupMailNickname
        if (params.groupDescription) result.description = params.groupDescription
        if (params.groupTypes !== undefined) result.groupTypes = params.groupTypes
        if (params.operation === 'update_group') {
          result.visibility = params.visibility || undefined
        } else if (params.operation === 'create_group') {
          result.visibility = params.visibilityCreate || undefined
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string' },
    userId: { type: 'string' },
    displayName: { type: 'string' },
    mailNickname: { type: 'string' },
    userPrincipalName: { type: 'string' },
    password: { type: 'string' },
    accountEnabled: { type: 'string' },
    accountEnabledCreate: { type: 'string' },
    givenName: { type: 'string' },
    surname: { type: 'string' },
    jobTitle: { type: 'string' },
    department: { type: 'string' },
    officeLocation: { type: 'string' },
    mobilePhone: { type: 'string' },
    top: { type: 'string' },
    filter: { type: 'string' },
    search: { type: 'string' },
    nextLink: { type: 'string' },
    groupId: { type: 'string' },
    groupDisplayName: { type: 'string' },
    groupMailNickname: { type: 'string' },
    groupDescription: { type: 'string' },
    mailEnabled: { type: 'string' },
    securityEnabled: { type: 'string' },
    groupTypes: { type: 'string' },
    visibility: { type: 'string' },
    visibilityCreate: { type: 'string' },
    memberId: { type: 'string' },
    addSkuIds: { type: 'string' },
    removeSkuIds: { type: 'string' },
    disabledPlanIds: { type: 'string' },
    forceChangePasswordNextSignIn: { type: 'string' },
    forceChangePasswordNextSignInWithMfa: { type: 'string' },
    newPassword: { type: 'string' },
    signInFilter: { type: 'string' },
    auditFilter: { type: 'string' },
    appRoleFilter: { type: 'string' },
    resourceId: { type: 'string' },
    appRoleId: { type: 'string' },
    appRoleAssignmentId: { type: 'string' },
    servicePrincipalId: { type: 'string' },
    servicePrincipalSearch: { type: 'string' },
    servicePrincipalFilter: { type: 'string' },
    directoryRoleId: { type: 'string' },
    deviceObjectId: { type: 'string' },
    deviceSearch: { type: 'string' },
    deviceFilter: { type: 'string' },
    deviceRelationship: { type: 'string' },
    policyId: { type: 'string' },
    policyFilter: { type: 'string' },
  },
  outputs: {
    users: {
      type: 'array',
      description:
        'User objects (id, displayName, givenName, surname, userPrincipalName, mail, jobTitle, department, officeLocation, mobilePhone, accountEnabled)',
    },
    userCount: { type: 'number', description: 'Number of users returned on this page' },
    user: { type: 'json', description: 'The single user this operation created or read' },
    userId: { type: 'string', description: 'Object ID of the user the operation acted on' },
    userPrincipalName: { type: 'string', description: 'User principal name of that user' },
    displayName: { type: 'string', description: 'Display name of the user the operation acted on' },
    groups: {
      type: 'array',
      description:
        'Group objects (id, displayName, description, mail, mailEnabled, securityEnabled, groupTypes, visibility)',
    },
    groupCount: { type: 'number', description: 'Number of groups returned on this page' },
    group: { type: 'json', description: 'The single group this operation created or read' },
    groupId: { type: 'string', description: 'Object ID of the group the operation acted on' },
    members: {
      type: 'array',
      description: 'Group or directory role members (id, displayName, mail, odataType)',
    },
    memberCount: { type: 'number', description: 'Number of members returned on this page' },
    memberId: { type: 'string', description: 'Object ID of the member the operation acted on' },
    roles: {
      type: 'array',
      description: 'Activated directory roles (id, displayName, description, roleTemplateId)',
    },
    roleCount: { type: 'number', description: 'Number of directory roles returned' },
    directoryRoleId: {
      type: 'string',
      description: 'Object ID of the directory role the operation acted on',
    },
    skus: {
      type: 'array',
      description:
        'Subscribed SKUs (skuId, skuPartNumber, consumedUnits, prepaidUnits, servicePlans)',
    },
    skuCount: { type: 'number', description: 'Number of subscribed SKUs returned' },
    licenses: {
      type: 'array',
      description: 'License details assigned to the user (skuId, skuPartNumber, servicePlans)',
    },
    licenseCount: { type: 'number', description: 'Number of license details returned' },
    assignedLicenses: {
      type: 'array',
      description: 'Licenses the user holds after the assign or remove operation',
    },
    assignments: {
      type: 'array',
      description:
        'App role assignments (id, appRoleId, principalId, principalDisplayName, resourceId, resourceDisplayName)',
    },
    assignmentCount: { type: 'number', description: 'Number of app role assignments returned' },
    assignment: { type: 'json', description: 'The app role assignment this operation created' },
    appRoleAssignmentId: {
      type: 'string',
      description: 'ID of the app role assignment that was removed',
    },
    servicePrincipals: {
      type: 'array',
      description:
        'Service principals (id, appId, displayName, servicePrincipalType, accountEnabled, appRoles)',
    },
    servicePrincipalCount: { type: 'number', description: 'Number of service principals returned' },
    devices: {
      type: 'array',
      description:
        'Devices (id, deviceId, displayName, operatingSystem, accountEnabled, isCompliant, isManaged, trustType)',
    },
    deviceCount: { type: 'number', description: 'Number of devices returned on this page' },
    device: { type: 'json', description: 'The single device this operation read' },
    policies: {
      type: 'array',
      description:
        'Conditional access policies (id, displayName, state, conditions, grantControls, sessionControls)',
    },
    policyCount: { type: 'number', description: 'Number of conditional access policies returned' },
    policy: {
      type: 'json',
      description: 'The single conditional access policy this operation read',
    },
    audits: {
      type: 'array',
      description:
        'Directory audit events (id, activityDateTime, activityDisplayName, initiatedBy, targetResources, result)',
    },
    auditCount: { type: 'number', description: 'Number of directory audit events returned' },
    signIns: {
      type: 'array',
      description:
        'Sign-in events (id, createdDateTime, userPrincipalName, appDisplayName, ipAddress, status)',
    },
    signInCount: { type: 'number', description: 'Number of sign-in events returned' },
    methods: {
      type: 'array',
      description: 'Registered authentication methods for the user (id, odataType, and its detail)',
    },
    methodCount: { type: 'number', description: 'Number of authentication methods returned' },
    newPassword: {
      type: 'string',
      description: 'Temporary password produced by the password reset, when Graph returned one',
    },
    operationLocation: {
      type: 'string',
      description: 'URL for polling the long-running password reset operation',
    },
    accepted: {
      type: 'boolean',
      description: 'True when Graph accepted the password reset for asynchronous processing',
    },
    forceChangePasswordNextSignIn: {
      type: 'boolean',
      description: 'Whether the user must change the password at next sign-in',
    },
    added: { type: 'boolean', description: 'True when the member was added' },
    removed: { type: 'boolean', description: 'True when the member or assignment was removed' },
    updated: { type: 'boolean', description: 'True when the resource was updated' },
    deleted: { type: 'boolean', description: 'True when the resource was deleted' },
    revoked: { type: 'boolean', description: "True when the user's sign-in sessions were revoked" },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page, present only when more results exist',
    },
  },
}

export const MicrosoftAdBlockMeta = {
  tags: ['identity', 'microsoft-365'],
  url: 'https://www.microsoft.com/security/business/identity-access/microsoft-entra-id',
  templates: [
    {
      icon: AzureIcon,
      title: 'Azure AD provisioning',
      prompt:
        'Build a workflow that on a Workday new-hire event creates the Azure AD user account, assigns the right group memberships, and writes the provisioning record to an audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD offboarding sweep',
      prompt:
        'Create a workflow that on a Workday termination disables the Azure AD account, removes its group memberships, and writes the security audit record.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD access review',
      prompt:
        'Build a scheduled quarterly workflow that lists Azure AD group memberships, requests owner attestation in Microsoft Teams, and writes the audit log to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD password-age reminder',
      prompt:
        'Create a scheduled workflow that lists Azure AD users, flags accounts whose last password change is older than the policy window, sends targeted reset reminders, and writes the compliance audit.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD stale-account sweeper',
      prompt:
        'Build a scheduled workflow that lists Azure AD accounts inactive for 90+ days, requests owner re-attestation, and disables accounts that fail attestation.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD privileged-group auditor',
      prompt:
        'Create a scheduled monthly workflow that lists the members of privileged Azure AD groups, requests owner attestation for each, and writes the review to an audit table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: AzureIcon,
      title: 'Azure AD privileged-access monitor',
      prompt:
        'Build a scheduled workflow that lists privileged Azure AD group members each run, compares against the last snapshot in a table, and pings the security Microsoft Teams channel on any add or removal.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'provision-new-user',
      description:
        'Create a new Azure AD (Entra ID) user account and add it to the right groups. Use when onboarding an employee or contractor.',
      content:
        '# Provision New User\n\nCreate an Azure AD user and grant initial group access.\n\n## Steps\n1. Use Create User with the required fields: display name, mail nickname, user principal name (e.g. name@yourdomain.com), and an initial password. Set Account Enabled to Yes.\n2. Fill optional profile fields when available: first name, last name, job title, department, office location, and mobile phone.\n3. For each group the person should belong to, resolve the group with Get Group or List Groups, then call Add Group Member with the new user id.\n4. Confirm membership with List Group Members.\n\n## Output\nReturn the created user id, user principal name, and the list of groups they were added to. If a username collision or password-policy error occurs, report it clearly instead of retrying blindly.',
    },
    {
      name: 'offboard-user',
      description:
        'Disable an Azure AD account and strip its group memberships when someone leaves. Use for secure offboarding.',
      content:
        '# Offboard User\n\nRevoke access for a departing user.\n\n## Steps\n1. Resolve the account with Get User by user principal name or id.\n2. Use Update User to set Account Enabled to No so the user can no longer sign in.\n3. Use List Group Members or the user record to enumerate the groups the user belongs to.\n4. For each group, call Remove Group Member with the user id.\n\n## Output\nReturn the disabled user id and the list of groups the user was removed from. Note any group where removal failed so it can be handled manually, and recommend writing the action to an audit record.',
    },
    {
      name: 'audit-group-membership',
      description:
        'List the members of an Azure AD group for an access review. Use for periodic attestation of privileged or sensitive groups.',
      content:
        '# Audit Group Membership\n\nProduce a current membership snapshot for a group.\n\n## Steps\n1. Resolve the target group with Get Group or List Groups (filter or search by name).\n2. Call List Group Members for the group id, raising Max Results if the group is large. If the response includes a Next Page link, keep calling List Group Members with that link until it comes back empty to capture every member.\n3. For each member, optionally call Get User to enrich with job title, department, and account-enabled status.\n\n## Output\nReturn a table of members with id, display name, email, department, and whether the account is enabled. Highlight disabled or stale accounts that still hold membership and should be reviewed for removal.',
    },
    {
      name: 'search-directory-users',
      description:
        'Search Azure AD (Entra ID) for users matching a name, department, or other attribute. Use for directory lookups and reporting.',
      content:
        "# Search Directory Users\n\nFind users in the directory by attribute instead of enumerating everyone.\n\n## Steps\n1. Use List Users with Search set to the name or email fragment, or Filter set to an OData expression (e.g. `department eq 'Sales'`) for attribute-based lookups. Search and Filter cannot be combined in one call.\n2. If the result set is large, follow the Next Page link returned in the response to page through additional results.\n3. Optionally call Get User for a specific match to retrieve full profile detail.\n\n## Output\nReturn the matching users with id, display name, user principal name, department, and account-enabled status. State clearly when Max Results or pagination limits mean the list may be incomplete.",
    },
    {
      name: 'manage-group-membership',
      description:
        'Add or remove specific users from an Azure AD (Entra ID) group on demand, outside of onboarding/offboarding flows. Use for ad hoc access changes and team restructuring.',
      content:
        "# Manage Group Membership\n\nApply a one-off membership change to a group.\n\n## Steps\n1. Resolve the group with Get Group or List Groups, and resolve each affected user with Get User or List Users.\n2. Call Add Group Member or Remove Group Member with the group id and each user id.\n3. Confirm the change with List Group Members.\n\n## Output\nReturn which users were added or removed and the group's current member count. Report any member that failed to add or remove (e.g. already a member, or not found) instead of silently skipping it.",
    },
  ],
} as const satisfies BlockMeta
