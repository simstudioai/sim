import { OktaIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { OktaResponse } from '@/tools/okta/types'

/**
 * Coerces a numeric subBlock value, dropping anything that is not a real number.
 *
 * These fields are free-text inputs, so a stray non-numeric entry would otherwise
 * become `NaN` and serialize to `null`, which Okta rejects with a validation
 * error that points at the wrong thing. Dropping the field instead lets Okta
 * apply its own default.
 */
function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Operations where Okta sends the notification email unless told otherwise. */
const SEND_EMAIL_DEFAULT_ON_OPERATIONS = ['okta_activate_user', 'okta_reset_password']

const SEND_EMAIL_DEFAULT_ON = new Set(SEND_EMAIL_DEFAULT_ON_OPERATIONS)

/**
 * The cursor subBlock each paginated operation reads.
 *
 * Okta's `after` cursor is opaque and scoped to the endpoint that minted it, so
 * every operation carries its own field rather than sharing one.
 */
const CURSOR_FIELD_BY_OPERATION: Record<string, string> = {
  okta_list_users: 'after',
  okta_list_groups: 'groupsAfter',
  okta_list_group_members: 'groupMembersAfter',
  okta_get_logs: 'logsAfter',
  okta_list_apps: 'appsAfter',
  okta_list_app_users: 'appUsersAfter',
  okta_list_app_groups: 'appGroupsAfter',
  okta_list_group_rules: 'groupRulesAfter',
}

/** Treats a blank subBlock value as absent. */
function blankToUndefined(value: unknown): unknown {
  return value === null || value === '' ? undefined : value
}

export const OktaBlock: BlockConfig<OktaResponse> = {
  type: 'okta',
  name: 'Okta',
  description: 'Manage users, groups, apps, and MFA in Okta',
  longDescription:
    'Integrate Okta identity management into your workflow. Manage users, groups, and group rules. Run service desk actions like resetting MFA factors and clearing sessions. Review and change application assignments and admin roles. Query the System Log to audit sign-ins and admin changes.',
  docsLink: 'https://docs.sim.ai/integrations/okta',
  category: 'tools',
  authMode: AuthMode.ApiKey,
  integrationType: IntegrationType.Security,
  bgColor: '#191919',
  iconColor: '#007DC1',
  icon: OktaIcon,
  canvasPresentation: {
    defaultTitle: 'Okta',
    sentences: {
      byOperation: {
        okta_list_users: [
          'List users',
          { text: ', matching', field: 'search' },
          { text: ', filtered by', field: 'filter' },
          { text: ', up to', field: 'limit' },
        ],
        okta_get_user: [{ text: 'Read user', field: 'userId', core: true }],
        okta_create_user: [
          { text: 'Create user', field: 'email', core: true },
          { text: ', with job title', field: 'title' },
          { text: ', in department', field: 'department' },
        ],
        okta_update_user: [
          { text: 'Update the profile of user', field: 'userId', core: true },
          { text: ', setting email to', field: 'email' },
        ],
        okta_activate_user: [{ text: 'Activate user', field: 'userId', core: true }],
        okta_deactivate_user: [{ text: 'Deactivate user', field: 'userId', core: true }],
        okta_suspend_user: [{ text: 'Suspend user', field: 'userId', core: true }],
        okta_unsuspend_user: [{ text: 'Unsuspend user', field: 'userId', core: true }],
        okta_reset_password: [{ text: 'Reset the password of user', field: 'userId', core: true }],
        okta_delete_user: [{ text: 'Permanently delete user', field: 'userId', core: true }],
        okta_list_groups: [
          'List groups',
          { text: ', matching', field: 'search' },
          { text: ', filtered by', field: 'filter' },
          { text: ', up to', field: 'limit' },
        ],
        okta_get_group: [{ text: 'Read group', field: 'groupId', core: true }],
        okta_create_group: [{ text: 'Create group', field: 'groupName', core: true }],
        okta_update_group: [
          { text: 'Rename group', field: 'groupId', core: true },
          { text: 'to', field: 'groupName' },
        ],
        okta_delete_group: [{ text: 'Delete group', field: 'groupId', core: true }],
        okta_add_user_to_group: [
          { text: 'Add user', field: 'userId', core: true },
          { text: 'to group', field: 'groupId' },
        ],
        okta_remove_user_from_group: [
          { text: 'Remove user', field: 'userId', core: true },
          { text: 'from group', field: 'groupId' },
        ],
        okta_list_group_members: [
          { text: 'List the members of group', field: 'groupId', core: true },
          { text: ', up to', field: 'limit' },
        ],
        okta_get_logs: [
          'Read System Log events',
          { text: ', matching', field: 'q' },
          { text: ', filtered by', field: 'filter' },
          { text: ', since', field: 'since' },
          { text: ', until', field: 'until' },
        ],
        okta_clear_user_sessions: [
          { text: 'Clear every session of user', field: 'userId', core: true },
        ],
        okta_get_session: [{ text: 'Read session', field: 'sessionId', core: true }],
        okta_revoke_session: [{ text: 'Revoke session', field: 'sessionId', core: true }],
        okta_list_factors: [{ text: 'List the MFA factors of user', field: 'userId', core: true }],
        okta_get_factor: [
          { text: 'Read factor', field: 'factorId', core: true },
          { text: 'of user', field: 'userId' },
        ],
        okta_enroll_factor: [
          { text: 'Enroll factor', field: 'factorType', core: true },
          { text: 'for user', field: 'userId' },
        ],
        okta_reset_factor: [
          { text: 'Reset factor', field: 'factorId', core: true },
          { text: 'for user', field: 'userId' },
        ],
        okta_reset_all_factors: [
          { text: 'Reset every MFA factor of user', field: 'userId', core: true },
        ],
        okta_list_apps: [
          'List applications',
          { text: ', matching', field: 'q' },
          { text: ', filtered by', field: 'filter' },
          { text: ', up to', field: 'limit' },
        ],
        okta_get_app: [{ text: 'Read application', field: 'appId', core: true }],
        okta_list_app_users: [
          { text: 'List the users assigned to application', field: 'appId', core: true },
          { text: ', matching', field: 'q' },
        ],
        okta_assign_user_to_app: [
          { text: 'Assign user', field: 'userId', core: true },
          { text: 'to application', field: 'appId' },
        ],
        okta_remove_user_from_app: [
          { text: 'Remove user', field: 'userId', core: true },
          { text: 'from application', field: 'appId', core: true },
        ],
        okta_list_app_groups: [
          { text: 'List the groups assigned to application', field: 'appId', core: true },
        ],
        okta_assign_group_to_app: [
          { text: 'Assign group', field: 'groupId', core: true },
          { text: 'to application', field: 'appId' },
        ],
        okta_remove_group_from_app: [
          { text: 'Remove group', field: 'groupId', core: true },
          { text: 'from application', field: 'appId' },
        ],
        okta_list_user_roles: [
          { text: 'List the admin roles of user', field: 'userId', core: true },
        ],
        okta_assign_user_role: [
          { text: 'Assign admin role', field: 'roleType', core: true },
          { text: 'to user', field: 'userId' },
        ],
        okta_remove_user_role: [
          { text: 'Remove admin role assignment', field: 'roleAssignmentId', core: true },
          { text: 'from user', field: 'userId' },
        ],
        okta_list_group_rules: [
          'List group rules',
          { text: ', matching', field: 'ruleSearch' },
          { text: ', up to', field: 'limit' },
        ],
        okta_get_group_rule: [{ text: 'Read group rule', field: 'groupRuleId', core: true }],
        okta_create_group_rule: [
          { text: 'Create group rule', field: 'ruleName', core: true },
          { text: ', matching users where', field: 'expression' },
        ],
        okta_activate_group_rule: [
          { text: 'Activate group rule', field: 'groupRuleId', core: true },
        ],
        okta_deactivate_group_rule: [
          { text: 'Deactivate group rule', field: 'groupRuleId', core: true },
        ],
        okta_delete_group_rule: [{ text: 'Delete group rule', field: 'groupRuleId', core: true }],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Users', id: 'okta_list_users' },
        { label: 'Get User', id: 'okta_get_user' },
        { label: 'Create User', id: 'okta_create_user' },
        { label: 'Update User', id: 'okta_update_user' },
        { label: 'Activate User', id: 'okta_activate_user' },
        { label: 'Deactivate User', id: 'okta_deactivate_user' },
        { label: 'Suspend User', id: 'okta_suspend_user' },
        { label: 'Unsuspend User', id: 'okta_unsuspend_user' },
        { label: 'Reset Password', id: 'okta_reset_password' },
        { label: 'Delete User', id: 'okta_delete_user' },
        { label: 'List Groups', id: 'okta_list_groups' },
        { label: 'Get Group', id: 'okta_get_group' },
        { label: 'Create Group', id: 'okta_create_group' },
        { label: 'Update Group', id: 'okta_update_group' },
        { label: 'Delete Group', id: 'okta_delete_group' },
        { label: 'Add User to Group', id: 'okta_add_user_to_group' },
        { label: 'Remove User from Group', id: 'okta_remove_user_from_group' },
        { label: 'List Group Members', id: 'okta_list_group_members' },
        { label: 'List Group Rules', id: 'okta_list_group_rules' },
        { label: 'Get Group Rule', id: 'okta_get_group_rule' },
        { label: 'Create Group Rule', id: 'okta_create_group_rule' },
        { label: 'Activate Group Rule', id: 'okta_activate_group_rule' },
        { label: 'Deactivate Group Rule', id: 'okta_deactivate_group_rule' },
        { label: 'Delete Group Rule', id: 'okta_delete_group_rule' },
        { label: 'List Factors', id: 'okta_list_factors' },
        { label: 'Get Factor', id: 'okta_get_factor' },
        { label: 'Enroll Factor', id: 'okta_enroll_factor' },
        { label: 'Reset Factor', id: 'okta_reset_factor' },
        { label: 'Reset All Factors', id: 'okta_reset_all_factors' },
        { label: 'Clear User Sessions', id: 'okta_clear_user_sessions' },
        { label: 'Get Session', id: 'okta_get_session' },
        { label: 'Revoke Session', id: 'okta_revoke_session' },
        { label: 'List Applications', id: 'okta_list_apps' },
        { label: 'Get Application', id: 'okta_get_app' },
        { label: 'List Application Users', id: 'okta_list_app_users' },
        { label: 'Assign User to Application', id: 'okta_assign_user_to_app' },
        { label: 'Remove User from Application', id: 'okta_remove_user_from_app' },
        { label: 'List Application Groups', id: 'okta_list_app_groups' },
        { label: 'Assign Group to Application', id: 'okta_assign_group_to_app' },
        { label: 'Remove Group from Application', id: 'okta_remove_group_from_app' },
        { label: 'List User Roles', id: 'okta_list_user_roles' },
        { label: 'Assign User Role', id: 'okta_assign_user_role' },
        { label: 'Remove User Role', id: 'okta_remove_user_role' },
        { label: 'Get System Log Events', id: 'okta_get_logs' },
      ],
      value: () => 'okta_list_users',
    },
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Okta API token',
      required: true,
    },
    {
      id: 'domain',
      title: 'Okta Domain',
      type: 'short-input',
      placeholder: 'dev-123456.okta.com',
      required: true,
    },
    // Search/Filter params (list operations)
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'profile.firstName eq "John"',
      condition: {
        field: 'operation',
        value: ['okta_list_users', 'okta_list_groups'],
      },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe who or what to search for',
        prompt:
          'Generate an Okta search expression. The grammar is SCIM-style: a property, an operator (eq, sw, co, gt, ge, lt, le), and a quoted value, combined with and/or and parentheses. User properties are prefixed with profile (profile.firstName, profile.email, profile.department) plus the top-level id, status, created, activated, statusChanged and lastUpdated. Group properties are type plus profile.name and profile.description. Example: profile.department eq "Engineering" and status eq "ACTIVE". Return ONLY the expression - no explanations, no extra text.',
      },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'status eq "ACTIVE"',
      condition: {
        field: 'operation',
        value: ['okta_list_users', 'okta_list_groups', 'okta_list_apps', 'okta_get_logs'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe how to narrow the results',
        prompt:
          'Generate an Okta filter expression. The grammar is SCIM-style: a property, an operator (eq, and for lastUpdated also gt, ge, lt, le), and a quoted value, combined with and/or. Each listing supports a limited property set. Users: status, lastUpdated, id, profile.login, profile.email, profile.firstName, profile.lastName. Groups: id, type, lastUpdated, lastMembershipUpdated. Applications: id, status, name. System Log: any event property, such as eventType, outcome.result, actor.alternateId or client.ipAddress. Example: eventType eq "user.session.start" and outcome.result eq "FAILURE". Return ONLY the expression - no explanations, no extra text.',
      },
    },
    {
      id: 'q',
      title: 'Query',
      type: 'short-input',
      placeholder: 'Keyword to search for',
      condition: {
        field: 'operation',
        value: ['okta_get_logs', 'okta_list_apps', 'okta_list_app_users', 'okta_list_app_groups'],
      },
    },
    {
      /**
       * Group rules take a plain keyword on `search`, not the SCIM-style
       * expression the Search field's wand generates, so they get their own
       * field rather than sharing one that would produce a silently
       * non-matching query.
       */
      id: 'ruleSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Keyword to search rules for',
      condition: { field: 'operation', value: 'okta_list_group_rules' },
    },
    // User ID (shared across user operations that need it)
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'User ID or login (email)',
      condition: {
        field: 'operation',
        value: [
          'okta_get_user',
          'okta_update_user',
          'okta_activate_user',
          'okta_deactivate_user',
          'okta_suspend_user',
          'okta_unsuspend_user',
          'okta_reset_password',
          'okta_delete_user',
          'okta_add_user_to_group',
          'okta_remove_user_from_group',
          'okta_clear_user_sessions',
          'okta_list_factors',
          'okta_get_factor',
          'okta_enroll_factor',
          'okta_reset_factor',
          'okta_reset_all_factors',
          'okta_assign_user_to_app',
          'okta_remove_user_from_app',
          'okta_list_user_roles',
          'okta_assign_user_role',
          'okta_remove_user_role',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'okta_get_user',
          'okta_update_user',
          'okta_activate_user',
          'okta_deactivate_user',
          'okta_suspend_user',
          'okta_unsuspend_user',
          'okta_reset_password',
          'okta_delete_user',
          'okta_add_user_to_group',
          'okta_remove_user_from_group',
          'okta_clear_user_sessions',
          'okta_list_factors',
          'okta_get_factor',
          'okta_enroll_factor',
          'okta_reset_factor',
          'okta_reset_all_factors',
          'okta_assign_user_to_app',
          'okta_remove_user_from_app',
          'okta_list_user_roles',
          'okta_assign_user_role',
          'okta_remove_user_role',
        ],
      },
    },
    // Group ID (shared across group operations that need it)
    {
      id: 'groupId',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Okta group ID',
      condition: {
        field: 'operation',
        value: [
          'okta_get_group',
          'okta_update_group',
          'okta_delete_group',
          'okta_add_user_to_group',
          'okta_remove_user_from_group',
          'okta_list_group_members',
          'okta_assign_group_to_app',
          'okta_remove_group_from_app',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'okta_get_group',
          'okta_update_group',
          'okta_delete_group',
          'okta_add_user_to_group',
          'okta_remove_user_from_group',
          'okta_list_group_members',
          'okta_assign_group_to_app',
          'okta_remove_group_from_app',
        ],
      },
    },
    // Create/Update User profile params
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: ['okta_create_user', 'okta_update_user'] },
      required: { field: 'operation', value: 'okta_create_user' },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: ['okta_create_user', 'okta_update_user'] },
      required: { field: 'operation', value: 'okta_create_user' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'john.doe@example.com',
      condition: { field: 'operation', value: ['okta_create_user', 'okta_update_user'] },
      required: { field: 'operation', value: 'okta_create_user' },
    },
    {
      id: 'login',
      title: 'Login',
      type: 'short-input',
      placeholder: 'john.doe@example.com (defaults to email)',
      condition: { field: 'operation', value: ['okta_create_user', 'okta_update_user'] },
      mode: 'advanced',
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Set user password',
      condition: { field: 'operation', value: 'okta_create_user' },
      mode: 'advanced',
    },
    {
      id: 'mobilePhone',
      title: 'Mobile Phone',
      type: 'short-input',
      placeholder: '+1234567890',
      condition: { field: 'operation', value: ['okta_create_user', 'okta_update_user'] },
      mode: 'advanced',
    },
    {
      id: 'title',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Software Engineer',
      condition: { field: 'operation', value: ['okta_create_user', 'okta_update_user'] },
      mode: 'advanced',
    },
    {
      id: 'department',
      title: 'Department',
      type: 'short-input',
      placeholder: 'Engineering',
      condition: { field: 'operation', value: ['okta_create_user', 'okta_update_user'] },
      mode: 'advanced',
    },
    /**
     * Okta's `activate` default is inverted between the two operations that take
     * it: creating a user activates unless told otherwise, enrolling a factor
     * does not. One shared switch could only be seeded for one of them, and
     * because it is advanced `shouldSerializeSubBlock` skips its condition, so
     * the other operation inherited the wrong answer. Each gets its own field
     * and the params mapper picks by operation.
     */
    {
      id: 'activate',
      title: 'Activate Immediately',
      type: 'switch',
      value: () => 'true',
      condition: { field: 'operation', value: 'okta_create_user' },
      mode: 'advanced',
    },
    {
      id: 'activateFactor',
      title: 'Activate Immediately',
      type: 'switch',
      condition: { field: 'operation', value: 'okta_enroll_factor' },
      mode: 'advanced',
    },
    // Group name (for create/update group)
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'Engineering Team',
      condition: { field: 'operation', value: ['okta_create_group', 'okta_update_group'] },
      /**
       * Required only on create, where Okta has no stored name to fall back on.
       * An update is a read-modify-write that carries the stored name through, so
       * a blank name means "leave it alone" — requiring it here would block a
       * description-only update the tool and API both accept.
       */
      required: { field: 'operation', value: ['okta_create_group'] },
    },
    {
      id: 'groupDescription',
      title: 'Group Description',
      type: 'short-input',
      placeholder: 'Description for the group',
      condition: { field: 'operation', value: ['okta_create_group', 'okta_update_group'] },
    },
    /**
     * Okta's `sendEmail` default is not uniform: activation and password reset
     * default to sending, deactivation and removal default to not sending. One
     * shared switch could only be seeded for one of those, so the two groups get
     * their own field and the params mapper picks by operation.
     */
    {
      id: 'sendEmail',
      title: 'Send Email',
      type: 'switch',
      value: () => 'true',
      condition: {
        field: 'operation',
        value: SEND_EMAIL_DEFAULT_ON_OPERATIONS,
      },
      mode: 'advanced',
    },
    {
      id: 'sendDeactivationEmail',
      title: 'Send Email',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['okta_deactivate_user', 'okta_delete_user', 'okta_remove_user_from_app'],
      },
      mode: 'advanced',
    },
    // Group rule params
    {
      id: 'groupRuleId',
      title: 'Group Rule ID',
      type: 'short-input',
      placeholder: 'Okta group rule ID',
      condition: {
        field: 'operation',
        value: [
          'okta_get_group_rule',
          'okta_activate_group_rule',
          'okta_deactivate_group_rule',
          'okta_delete_group_rule',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'okta_get_group_rule',
          'okta_activate_group_rule',
          'okta_deactivate_group_rule',
          'okta_delete_group_rule',
        ],
      },
    },
    {
      id: 'ruleName',
      title: 'Rule Name',
      type: 'short-input',
      placeholder: 'Engineers',
      condition: { field: 'operation', value: 'okta_create_group_rule' },
      required: { field: 'operation', value: 'okta_create_group_rule' },
    },
    {
      id: 'expression',
      title: 'Expression',
      type: 'short-input',
      placeholder: 'user.department=="Engineering"',
      condition: { field: 'operation', value: 'okta_create_group_rule' },
      required: { field: 'operation', value: 'okta_create_group_rule' },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe which users the rule should match',
        prompt:
          'Generate an Okta Expression Language predicate that evaluates to a boolean over a user profile. Reference profile attributes as user.<attribute>, combine them with && and ||, and compare with == or !=. Example: user.department=="Engineering" && user.countryCode=="US". Return ONLY the expression - no explanations, no extra text.',
      },
    },
    {
      id: 'assignUserToGroupIds',
      title: 'Assign to Group IDs',
      type: 'short-input',
      placeholder: 'Comma-separated group IDs',
      condition: { field: 'operation', value: 'okta_create_group_rule' },
      required: { field: 'operation', value: 'okta_create_group_rule' },
    },
    {
      id: 'excludedUserIds',
      title: 'Excluded User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs to exclude',
      condition: { field: 'operation', value: 'okta_create_group_rule' },
      mode: 'advanced',
    },
    {
      id: 'removeUsers',
      title: 'Remove Assigned Users',
      type: 'switch',
      condition: { field: 'operation', value: 'okta_delete_group_rule' },
      mode: 'advanced',
    },
    // Factor params
    {
      id: 'factorId',
      title: 'Factor ID',
      type: 'short-input',
      placeholder: 'Okta factor ID',
      condition: { field: 'operation', value: ['okta_get_factor', 'okta_reset_factor'] },
      required: { field: 'operation', value: ['okta_get_factor', 'okta_reset_factor'] },
    },
    {
      id: 'factorType',
      title: 'Factor Type',
      type: 'dropdown',
      options: [
        { label: 'SMS', id: 'sms' },
        { label: 'Voice Call', id: 'call' },
        { label: 'Email', id: 'email' },
        { label: 'Security Question', id: 'question' },
        { label: 'Okta Verify Push', id: 'push' },
        { label: 'Software TOTP', id: 'token:software:totp' },
        { label: 'U2F', id: 'u2f' },
        { label: 'WebAuthn', id: 'webauthn' },
      ],
      condition: { field: 'operation', value: 'okta_enroll_factor' },
      required: { field: 'operation', value: 'okta_enroll_factor' },
    },
    {
      id: 'provider',
      title: 'Factor Provider',
      type: 'dropdown',
      options: [
        { label: 'Okta', id: 'OKTA' },
        { label: 'Google', id: 'GOOGLE' },
        { label: 'FIDO', id: 'FIDO' },
        { label: 'Duo', id: 'DUO' },
        { label: 'RSA', id: 'RSA' },
        { label: 'Symantec', id: 'SYMANTEC' },
        { label: 'Yubico', id: 'YUBICO' },
        { label: 'Custom', id: 'CUSTOM' },
      ],
      condition: { field: 'operation', value: 'okta_enroll_factor' },
      required: { field: 'operation', value: 'okta_enroll_factor' },
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+14155550123 (required for SMS and voice call)',
      condition: { field: 'operation', value: 'okta_enroll_factor' },
    },
    {
      id: 'factorEmail',
      title: 'Factor Email',
      type: 'short-input',
      placeholder: 'user@example.com (required for the email factor)',
      condition: { field: 'operation', value: 'okta_enroll_factor' },
      mode: 'advanced',
    },
    {
      id: 'securityQuestion',
      title: 'Security Question',
      type: 'short-input',
      placeholder: 'disliked_food (required for the question factor)',
      condition: { field: 'operation', value: 'okta_enroll_factor' },
      mode: 'advanced',
    },
    {
      id: 'securityAnswer',
      title: 'Security Answer',
      type: 'short-input',
      password: true,
      placeholder: 'Answer, minimum 4 characters',
      condition: { field: 'operation', value: 'okta_enroll_factor' },
      mode: 'advanced',
    },
    {
      id: 'removeRecoveryEnrollment',
      title: 'Remove Recovery Enrollment',
      type: 'switch',
      condition: { field: 'operation', value: 'okta_reset_factor' },
      mode: 'advanced',
    },
    // Session params
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Okta session ID',
      condition: { field: 'operation', value: ['okta_get_session', 'okta_revoke_session'] },
      required: { field: 'operation', value: ['okta_get_session', 'okta_revoke_session'] },
    },
    {
      id: 'oauthTokens',
      title: 'Revoke OAuth Tokens',
      type: 'switch',
      condition: { field: 'operation', value: 'okta_clear_user_sessions' },
      mode: 'advanced',
    },
    {
      id: 'forgetDevices',
      title: 'Forget Devices',
      type: 'switch',
      /**
       * Okta defaults this to true, so an unseeded switch would render off while
       * remembered factors were in fact being cleared.
       */
      value: () => 'true',
      condition: { field: 'operation', value: 'okta_clear_user_sessions' },
      mode: 'advanced',
    },
    // Application params
    {
      id: 'appId',
      title: 'Application ID',
      type: 'short-input',
      placeholder: 'Okta application ID',
      condition: {
        field: 'operation',
        value: [
          'okta_get_app',
          'okta_list_app_users',
          'okta_assign_user_to_app',
          'okta_remove_user_from_app',
          'okta_list_app_groups',
          'okta_assign_group_to_app',
          'okta_remove_group_from_app',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'okta_get_app',
          'okta_list_app_users',
          'okta_assign_user_to_app',
          'okta_remove_user_from_app',
          'okta_list_app_groups',
          'okta_assign_group_to_app',
          'okta_remove_group_from_app',
        ],
      },
    },
    {
      id: 'appUserName',
      title: 'Application Username',
      type: 'short-input',
      placeholder: 'Username the user signs in to the app with',
      condition: { field: 'operation', value: 'okta_assign_user_to_app' },
    },
    {
      id: 'scope',
      title: 'Assignment Scope',
      type: 'dropdown',
      options: [
        { label: 'User', id: 'USER' },
        { label: 'Group', id: 'GROUP' },
      ],
      condition: { field: 'operation', value: 'okta_assign_user_to_app' },
      mode: 'advanced',
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Assignment priority',
      condition: { field: 'operation', value: 'okta_assign_group_to_app' },
      mode: 'advanced',
    },
    {
      id: 'includeNonDeleted',
      title: 'Include Non-Deleted',
      type: 'switch',
      condition: { field: 'operation', value: 'okta_list_apps' },
      mode: 'advanced',
    },
    // Admin role params
    {
      id: 'roleType',
      title: 'Role Type',
      type: 'dropdown',
      options: [
        { label: 'Super Admin', id: 'SUPER_ADMIN' },
        { label: 'Org Admin', id: 'ORG_ADMIN' },
        { label: 'App Admin', id: 'APP_ADMIN' },
        { label: 'User Admin', id: 'USER_ADMIN' },
        { label: 'Help Desk Admin', id: 'HELP_DESK_ADMIN' },
        { label: 'Read Only Admin', id: 'READ_ONLY_ADMIN' },
        { label: 'API Access Management Admin', id: 'API_ACCESS_MANAGEMENT_ADMIN' },
        { label: 'Group Membership Admin', id: 'GROUP_MEMBERSHIP_ADMIN' },
        { label: 'Report Admin', id: 'REPORT_ADMIN' },
        { label: 'Workflows Admin', id: 'WORKFLOWS_ADMIN' },
        { label: 'Access Certifications Admin', id: 'ACCESS_CERTIFICATIONS_ADMIN' },
        { label: 'Access Requests Admin', id: 'ACCESS_REQUESTS_ADMIN' },
        { label: 'Custom', id: 'CUSTOM' },
      ],
      condition: { field: 'operation', value: 'okta_assign_user_role' },
      required: { field: 'operation', value: 'okta_assign_user_role' },
    },
    {
      id: 'customRoleId',
      title: 'Custom Role ID',
      type: 'short-input',
      placeholder: 'ID of the custom role to grant',
      condition: {
        field: 'operation',
        value: 'okta_assign_user_role',
        and: { field: 'roleType', value: 'CUSTOM' },
      },
      required: {
        field: 'operation',
        value: 'okta_assign_user_role',
        and: { field: 'roleType', value: 'CUSTOM' },
      },
    },
    {
      id: 'resourceSetId',
      title: 'Resource Set ID',
      type: 'short-input',
      placeholder: 'Resource set the custom role applies to',
      condition: {
        field: 'operation',
        value: 'okta_assign_user_role',
        and: { field: 'roleType', value: 'CUSTOM' },
      },
      required: {
        field: 'operation',
        value: 'okta_assign_user_role',
        and: { field: 'roleType', value: 'CUSTOM' },
      },
    },
    {
      id: 'disableNotifications',
      title: 'Third-Party Admin',
      type: 'switch',
      condition: { field: 'operation', value: 'okta_assign_user_role' },
      mode: 'advanced',
    },
    {
      id: 'roleAssignmentId',
      title: 'Role Assignment ID',
      type: 'short-input',
      placeholder: 'Role assignment ID from List User Roles',
      condition: { field: 'operation', value: 'okta_remove_user_role' },
      required: { field: 'operation', value: 'okta_remove_user_role' },
    },
    // System Log params
    {
      id: 'since',
      title: 'Since',
      type: 'short-input',
      placeholder: '2026-08-01T00:00:00.000Z',
      condition: { field: 'operation', value: 'okta_get_logs' },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the start of the time window',
        prompt:
          'Generate an ISO 8601 UTC timestamp for the start of a System Log query window, for example 2026-08-01T00:00:00.000Z. Return ONLY the timestamp - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'until',
      title: 'Until',
      type: 'short-input',
      placeholder: '2026-08-15T00:00:00.000Z',
      condition: { field: 'operation', value: 'okta_get_logs' },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the end of the time window',
        prompt:
          'Generate an ISO 8601 UTC timestamp for the end of a System Log query window, for example 2026-08-15T00:00:00.000Z. Return ONLY the timestamp - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'ASCENDING' },
        { label: 'Descending', id: 'DESCENDING' },
      ],
      condition: { field: 'operation', value: 'okta_get_logs' },
      mode: 'advanced',
    },
    // Pagination
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results to return',
      condition: {
        field: 'operation',
        value: [
          'okta_list_users',
          'okta_list_groups',
          'okta_list_group_members',
          'okta_get_logs',
          'okta_list_apps',
          'okta_list_app_users',
          'okta_list_app_groups',
          'okta_list_group_rules',
        ],
      },
      mode: 'advanced',
    },
    /**
     * One cursor field per operation.
     *
     * Okta mints `after` per endpoint and rejects a cursor issued by another
     * one, so a single shared field carried a `list_users` cursor straight into
     * `list_groups`. Being advanced, `shouldSerializeSubBlock` skips its
     * condition, so the stale value reached the wire unseen; the params mapper
     * publishes only the field belonging to the selected operation.
     */
    {
      id: 'after',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous run',
      condition: { field: 'operation', value: 'okta_list_users' },
      mode: 'advanced',
    },
    {
      id: 'groupsAfter',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous run',
      condition: { field: 'operation', value: 'okta_list_groups' },
      mode: 'advanced',
    },
    {
      id: 'groupMembersAfter',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous run',
      condition: { field: 'operation', value: 'okta_list_group_members' },
      mode: 'advanced',
    },
    {
      id: 'logsAfter',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous run',
      condition: { field: 'operation', value: 'okta_get_logs' },
      mode: 'advanced',
    },
    {
      id: 'appsAfter',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous run',
      condition: { field: 'operation', value: 'okta_list_apps' },
      mode: 'advanced',
    },
    {
      id: 'appUsersAfter',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous run',
      condition: { field: 'operation', value: 'okta_list_app_users' },
      mode: 'advanced',
    },
    {
      id: 'appGroupsAfter',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous run',
      condition: { field: 'operation', value: 'okta_list_app_groups' },
      mode: 'advanced',
    },
    {
      id: 'groupRulesAfter',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous run',
      condition: { field: 'operation', value: 'okta_list_group_rules' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'okta_list_users',
      'okta_get_user',
      'okta_create_user',
      'okta_update_user',
      'okta_activate_user',
      'okta_deactivate_user',
      'okta_suspend_user',
      'okta_unsuspend_user',
      'okta_reset_password',
      'okta_delete_user',
      'okta_list_groups',
      'okta_get_group',
      'okta_create_group',
      'okta_update_group',
      'okta_delete_group',
      'okta_add_user_to_group',
      'okta_remove_user_from_group',
      'okta_list_group_members',
      'okta_list_group_rules',
      'okta_get_group_rule',
      'okta_create_group_rule',
      'okta_activate_group_rule',
      'okta_deactivate_group_rule',
      'okta_delete_group_rule',
      'okta_list_factors',
      'okta_get_factor',
      'okta_enroll_factor',
      'okta_reset_factor',
      'okta_reset_all_factors',
      'okta_clear_user_sessions',
      'okta_get_session',
      'okta_revoke_session',
      'okta_list_apps',
      'okta_get_app',
      'okta_list_app_users',
      'okta_assign_user_to_app',
      'okta_remove_user_from_app',
      'okta_list_app_groups',
      'okta_assign_group_to_app',
      'okta_remove_group_from_app',
      'okta_list_user_roles',
      'okta_assign_user_role',
      'okta_remove_user_role',
      'okta_get_logs',
    ],
    config: {
      tool: (params) => params.operation as string,
      /**
       * Every param this block can send is assigned here, including the ones it
       * decides to drop.
       *
       * The executor merges the result over the raw serialized inputs
       * (`{ ...inputs, ...transformedParams }`), so a key this function *omits*
       * keeps the raw subBlock string instead of being dropped. Assigning
       * `undefined` is what actually removes it: otherwise a non-numeric `limit`
       * would still reach Okta verbatim, and a blank field in a partial update
       * (`update_user` is a POST merge) would overwrite the stored Okta value
       * with an empty string rather than leaving it untouched.
       */
      params: (params) => {
        const operation = String(params.operation)
        const cursorField = CURSOR_FIELD_BY_OPERATION[operation]

        const result: Record<string, unknown> = {
          apiKey: params.apiKey,
          domain: params.domain,
          limit: toFiniteNumber(params.limit),
          priority: toFiniteNumber(params.priority),
          /** Group-specific UI fields carry the tool's generic param names. */
          name: blankToUndefined(params.groupName),
          description: blankToUndefined(params.groupDescription),
          /** Group rules get their own keyword field but the same wire param. */
          search:
            params.operation === 'okta_list_group_rules'
              ? blankToUndefined(params.ruleSearch)
              : blankToUndefined(params.search),
          /**
           * Keyed off the operation rather than `??`: both switches are advanced,
           * and `shouldSerializeSubBlock` skips `condition` for advanced fields,
           * so a stale value from a previously selected operation can still be
           * present here.
           */
          sendEmail: SEND_EMAIL_DEFAULT_ON.has(operation)
            ? blankToUndefined(params.sendEmail)
            : blankToUndefined(params.sendDeactivationEmail),
          /** Same stale-advanced-value hazard: pick the toggle for this operation. */
          activate:
            operation === 'okta_enroll_factor'
              ? blankToUndefined(params.activateFactor)
              : blankToUndefined(params.activate),
          /** A cursor is only valid on the endpoint that minted it. */
          after: cursorField ? blankToUndefined(params[cursorField]) : undefined,
        }

        const mappedKeys = new Set([
          'operation',
          'apiKey',
          'domain',
          'limit',
          'priority',
          'groupName',
          'groupDescription',
          'search',
          'ruleSearch',
          'sendEmail',
          'sendDeactivationEmail',
          'activate',
          'activateFactor',
          'after',
          ...Object.values(CURSOR_FIELD_BY_OPERATION),
        ])
        for (const [key, value] of Object.entries(params)) {
          if (!mappedKeys.has(key)) result[key] = blankToUndefined(value)
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Okta API token' },
    domain: { type: 'string', description: 'Okta domain' },
    userId: { type: 'string', description: 'User ID or login' },
    groupId: { type: 'string', description: 'Group ID' },
    search: { type: 'string', description: 'Search expression' },
    ruleSearch: { type: 'string', description: 'Keyword to search group rules for' },
    filter: { type: 'string', description: 'Filter expression' },
    limit: { type: 'number', description: 'Max results to return' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    email: { type: 'string', description: 'Email address' },
    login: { type: 'string', description: 'Login (defaults to email)' },
    password: { type: 'string', description: 'User password' },
    mobilePhone: { type: 'string', description: 'Mobile phone number' },
    title: { type: 'string', description: 'Job title' },
    department: { type: 'string', description: 'Department' },
    activate: { type: 'boolean', description: 'Activate user immediately on creation' },
    activateFactor: {
      type: 'boolean',
      description: 'Activate the MFA factor immediately on enrollment',
    },
    groupName: { type: 'string', description: 'Group name' },
    groupDescription: { type: 'string', description: 'Group description' },
    sendEmail: { type: 'boolean', description: 'Whether to send email notification' },
    sendDeactivationEmail: {
      type: 'boolean',
      description: 'Whether to send the deactivation or removal email notification',
    },
    q: { type: 'string', description: 'Keyword search query' },
    after: { type: 'string', description: 'Cursor for the next page of users' },
    groupsAfter: { type: 'string', description: 'Cursor for the next page of groups' },
    groupMembersAfter: { type: 'string', description: 'Cursor for the next page of group members' },
    logsAfter: { type: 'string', description: 'Cursor for the next page of System Log events' },
    appsAfter: { type: 'string', description: 'Cursor for the next page of applications' },
    appUsersAfter: {
      type: 'string',
      description: 'Cursor for the next page of application users',
    },
    appGroupsAfter: {
      type: 'string',
      description: 'Cursor for the next page of application groups',
    },
    groupRulesAfter: { type: 'string', description: 'Cursor for the next page of group rules' },
    since: { type: 'string', description: 'Start of the System Log time window' },
    until: { type: 'string', description: 'End of the System Log time window' },
    sortOrder: { type: 'string', description: 'System Log sort order' },
    sessionId: { type: 'string', description: 'Session ID' },
    oauthTokens: { type: 'boolean', description: 'Also revoke OAuth and OIDC tokens' },
    forgetDevices: { type: 'boolean', description: 'Clear remembered factors on all devices' },
    factorId: { type: 'string', description: 'MFA factor ID' },
    factorType: { type: 'string', description: 'MFA factor type to enroll' },
    provider: { type: 'string', description: 'MFA factor provider' },
    phoneNumber: { type: 'string', description: 'Phone number for the sms or call factor' },
    factorEmail: { type: 'string', description: 'Email address for the email factor' },
    securityQuestion: { type: 'string', description: 'Security question key' },
    securityAnswer: { type: 'string', description: 'Security question answer' },
    removeRecoveryEnrollment: {
      type: 'boolean',
      description: 'Also remove the phone number as a recovery method',
    },
    appId: { type: 'string', description: 'Application ID' },
    appUserName: { type: 'string', description: 'Username the user signs in to the app with' },
    scope: { type: 'string', description: 'Application assignment scope' },
    priority: { type: 'number', description: 'Application group assignment priority' },
    includeNonDeleted: {
      type: 'boolean',
      description: 'Include applications that are not deleted',
    },
    roleType: { type: 'string', description: 'Admin role type to assign' },
    customRoleId: { type: 'string', description: 'Custom role ID' },
    resourceSetId: { type: 'string', description: 'Resource set ID for a custom role' },
    disableNotifications: { type: 'boolean', description: 'Grant third-party admin status' },
    roleAssignmentId: { type: 'string', description: 'Role assignment ID to revoke' },
    groupRuleId: { type: 'string', description: 'Group rule ID' },
    ruleName: { type: 'string', description: 'Group rule name' },
    expression: { type: 'string', description: 'Okta expression driving the group rule' },
    assignUserToGroupIds: {
      type: 'string',
      description: 'Comma-separated group IDs the rule assigns users to',
    },
    excludedUserIds: {
      type: 'string',
      description: 'Comma-separated user IDs excluded from the rule',
    },
    removeUsers: {
      type: 'boolean',
      description: 'Remove users the rule assigned when deleting it',
    },
  },

  outputs: {
    users: {
      type: 'json',
      description:
        'Array of user objects (id, status, firstName, lastName, email, login, mobilePhone, title, department, created, lastLogin, lastUpdated)',
    },
    members: {
      type: 'json',
      description:
        'Array of group member user objects (id, status, firstName, lastName, email, login, mobilePhone, title, department, created, lastLogin, lastUpdated)',
    },
    groups: {
      type: 'json',
      description:
        'Array of group objects (id, name, description, type, created, lastUpdated, lastMembershipUpdated)',
    },
    id: { type: 'string', description: 'Resource ID' },
    status: { type: 'string', description: 'User status' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    email: { type: 'string', description: 'Email address' },
    login: { type: 'string', description: 'Login' },
    name: { type: 'string', description: 'Group name' },
    description: { type: 'string', description: 'Group description' },
    type: { type: 'string', description: 'Group type' },
    mobilePhone: { type: 'string', description: 'Mobile phone number' },
    secondEmail: { type: 'string', description: 'Secondary email address' },
    displayName: { type: 'string', description: 'Display name' },
    title: { type: 'string', description: 'Job title' },
    department: { type: 'string', description: 'Department' },
    organization: { type: 'string', description: 'Organization' },
    manager: { type: 'string', description: 'Manager name' },
    managerId: { type: 'string', description: 'Manager ID' },
    division: { type: 'string', description: 'Division' },
    employeeNumber: { type: 'string', description: 'Employee number' },
    userType: { type: 'string', description: 'User type' },
    lastLogin: { type: 'string', description: 'Last sign-in timestamp' },
    statusChanged: { type: 'string', description: 'Status change timestamp' },
    passwordChanged: { type: 'string', description: 'Password change timestamp' },
    lastMembershipUpdated: {
      type: 'string',
      description: 'Timestamp of the last group membership change',
    },
    count: { type: 'number', description: 'Number of results' },
    added: { type: 'boolean', description: 'Whether user was added to group' },
    removed: { type: 'boolean', description: 'Whether user was removed from group' },
    deactivated: { type: 'boolean', description: 'Whether user was deactivated' },
    suspended: { type: 'boolean', description: 'Whether user was suspended' },
    unsuspended: { type: 'boolean', description: 'Whether user was unsuspended' },
    activated: {
      type: 'string',
      description:
        'Activation timestamp on a user read. Activate User reports `true` here instead.',
    },
    deleted: { type: 'boolean', description: 'Whether resource was deleted' },
    activationUrl: { type: 'string', description: 'Activation URL (when sendEmail is false)' },
    activationToken: { type: 'string', description: 'Activation token (when sendEmail is false)' },
    resetPasswordUrl: {
      type: 'string',
      description: 'Password reset URL (when sendEmail is false)',
    },
    created: { type: 'string', description: 'Creation timestamp' },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
    events: {
      type: 'json',
      description:
        'Array of System Log events (uuid, published, eventType, severity, displayMessage, outcomeResult, actor and client details, targets)',
    },
    factors: {
      type: 'json',
      description:
        'Array of enrolled MFA factors (id, factorType, provider, vendorName, status, created, lastUpdated, profile)',
    },
    apps: {
      type: 'json',
      description:
        'Array of applications (id, name, label, status, signOnMode, features, created, lastUpdated)',
    },
    appUsers: {
      type: 'json',
      description:
        'Array of application user assignments (id, externalId, scope, status, syncState, userName, profile)',
    },
    appGroups: {
      type: 'json',
      description: 'Array of application group assignments (id, priority, lastUpdated, profile)',
    },
    roles: {
      type: 'json',
      description:
        'Array of admin role assignments (id, label, type, status, assignmentType, role, resourceSet)',
    },
    rules: {
      type: 'json',
      description:
        'Array of group rules (id, name, type, status, expression, assignUserToGroupIds, excludedUserIds)',
    },
    profile: { type: 'json', description: 'Factor, application, or app user profile attributes' },
    settings: { type: 'json', description: 'Application settings' },
    visibility: { type: 'json', description: 'Application visibility settings' },
    accessibility: { type: 'json', description: 'Application accessibility settings' },
    assignUserToGroupIds: { type: 'json', description: 'Groups a rule assigns matching users to' },
    excludedUserIds: { type: 'json', description: 'Users excluded from a group rule' },
    excludedGroupIds: {
      type: 'json',
      description:
        'Groups excluded from a group rule. Always empty — Okta does not currently support group exclusions.',
    },
    amr: { type: 'json', description: 'Authentication methods used to establish a session' },
    features: { type: 'json', description: 'Provisioning features enabled on an application' },
    label: { type: 'string', description: 'Application or role label' },
    signOnMode: { type: 'string', description: 'Application sign-on mode' },
    factorType: { type: 'string', description: 'MFA factor type' },
    provider: { type: 'string', description: 'MFA factor provider' },
    vendorName: { type: 'string', description: 'MFA factor vendor name' },
    scope: { type: 'string', description: 'Application assignment scope' },
    externalId: { type: 'string', description: 'ID of the user in the downstream application' },
    syncState: { type: 'string', description: 'Application provisioning sync state' },
    lastSync: { type: 'string', description: 'Last application provisioning sync' },
    userName: { type: 'string', description: 'Username the user signs in to the application with' },
    priority: { type: 'number', description: 'Application group assignment priority' },
    assignmentType: { type: 'string', description: 'How an admin role was assigned' },
    role: { type: 'string', description: 'Custom role ID' },
    resourceSet: { type: 'string', description: 'Resource set ID for a custom role' },
    expression: { type: 'string', description: 'Okta expression driving a group rule' },
    expressionType: { type: 'string', description: 'Group rule expression language' },
    userId: { type: 'string', description: 'User ID the operation acted on' },
    groupId: { type: 'string', description: 'Group ID the operation acted on' },
    appId: { type: 'string', description: 'Application ID the operation acted on' },
    factorId: { type: 'string', description: 'Factor ID the operation acted on' },
    sessionId: { type: 'string', description: 'Session ID the operation acted on' },
    groupRuleId: { type: 'string', description: 'Group rule ID the operation acted on' },
    roleAssignmentId: { type: 'string', description: 'Role assignment ID that was revoked' },
    createdAt: { type: 'string', description: 'Session creation timestamp' },
    expiresAt: { type: 'string', description: 'Session expiry timestamp' },
    lastPasswordVerification: {
      type: 'string',
      description: 'Timestamp of the last password verification',
    },
    lastFactorVerification: {
      type: 'string',
      description: 'Timestamp of the last factor verification',
    },
    idpId: { type: 'string', description: 'Identity provider ID' },
    idpType: { type: 'string', description: 'Identity provider type' },
    nextCursor: { type: 'string', description: 'Cursor for the next page of results' },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    assigned: { type: 'boolean', description: 'Whether the assignment was created' },
    enrolled: { type: 'boolean', description: 'Whether the factor was enrolled' },
    reset: { type: 'boolean', description: 'Whether the factors were reset' },
    cleared: { type: 'boolean', description: 'Whether the sessions were cleared' },
    revoked: { type: 'boolean', description: 'Whether the session was revoked' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

export const OktaBlockMeta = {
  tags: ['identity', 'automation'],
  url: 'https://www.okta.com',
  templates: [
    {
      icon: OktaIcon,
      title: 'Okta quarterly access review',
      prompt:
        'Build a scheduled quarterly workflow that pulls Okta group memberships per app, posts an attestation thread to each owner in Slack, captures confirmations, and writes the audit log to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OktaIcon,
      title: 'Okta orphan-account sweeper',
      prompt:
        'Create a scheduled workflow that compares Okta users against HRIS data, finds accounts for departed employees, disables them, and writes the sweep log to an audit table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: OktaIcon,
      title: 'Okta new-hire provisioning',
      prompt:
        'Build a workflow that polls Workday for new hires, creates the matching Okta user, adds them to the right groups for their role, and emails IT a provisioning summary.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday', 'gmail'],
    },
    {
      icon: OktaIcon,
      title: 'Okta compromised-account responder',
      prompt:
        'Create a workflow triggered by a CrowdStrike detection on a user that suspends the matching Okta account, resets their password, and pings the security Slack channel with the action taken.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['crowdstrike', 'slack'],
    },
    {
      icon: OktaIcon,
      title: 'Okta access-group provisioner',
      prompt:
        'Build a workflow that reads an access-request table, creates the Okta group if it is missing, adds the approved users to it, and writes the grant record back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
    },
    {
      icon: OktaIcon,
      title: 'Okta SSO group sync',
      prompt:
        'Create a scheduled workflow that mirrors org structure from Workday into Okta groups, ensuring group memberships stay in sync as employees change roles.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'sync'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: OktaIcon,
      title: 'Okta group membership audit',
      prompt:
        'Build a scheduled monthly workflow that lists every Okta group and its members, flags privileged groups with unexpected membership, and writes a review report for the security team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'onboard-user',
      description: 'Create an Okta user, set their profile, and add them to the right groups.',
      content:
        '# Onboard User\n\nProvision a new user in Okta and grant their group access.\n\n## Steps\n1. Run Create User with the profile fields: first name, last name, email, and login.\n2. Determine the groups the role requires, using List Groups to resolve group ids.\n3. Run Add User to Group for each required group.\n4. Activate the user if it was created in a staged state.\n\n## Output\nConfirm the new user id and login, and list the groups they were added to.',
    },
    {
      name: 'offboard-user',
      description: 'Deactivate an Okta user and remove their group memberships during offboarding.',
      content:
        '# Offboard User\n\nRevoke access for a departing user in Okta.\n\n## Steps\n1. Find the user with List Users or Get User to confirm the user id.\n2. Run Deactivate User (or Suspend User for a temporary hold) to block sign-in.\n3. Remove the user from sensitive groups with Remove User from Group.\n4. Only run Delete User when permanent removal is explicitly requested, since it is irreversible.\n\n## Output\nConfirm the user status and the groups removed. State clearly whether the account was deactivated or deleted.',
    },
    {
      name: 'audit-group-membership',
      description: 'List Okta groups and their members to audit access for a security review.',
      content:
        '# Audit Group Membership\n\nReview who belongs to Okta groups, focusing on privileged access.\n\n## Steps\n1. Run List Groups to enumerate the groups, or Get Group for a specific one.\n2. For each group of interest, run List Group Members.\n3. Highlight privileged or admin groups and call out any unexpected members.\n\n## Output\nA per-group roster with member counts, and a short list of access concerns to review.',
    },
    {
      name: 'reset-user-mfa',
      description: 'Reset a locked-out user MFA enrollment so they can enroll a factor again.',
      content:
        '# Reset User MFA\n\nClear a stuck multifactor enrollment, the most common Okta help desk request.\n\n## Steps\n1. Run List Factors for the user to see which factors are enrolled and their status.\n2. Reset the narrowest thing that fixes it: Reset Factor for one factor id, or Reset All Factors when every enrollment must go.\n3. Note that resetting push also unenrolls the related Okta Verify factors, and that factors cannot be reset on a deactivated user.\n4. Run Clear User Sessions if the user must be signed out of existing sessions before re-enrolling.\n\n## Output\nName the factors that were reset and state that the user must re-enroll before they can complete MFA again. Both resets are irreversible, so confirm the target user before running either.',
    },
    {
      name: 'investigate-sign-in-failures',
      description: 'Query the Okta System Log for failed sign-ins and suspicious authentication.',
      content:
        '# Investigate Sign-In Failures\n\nUse the System Log to explain why a user cannot sign in, or to review suspicious authentication.\n\n## Steps\n1. Run Get System Log Events with a Since and Until that bracket the incident.\n2. Filter to the events that matter, for example eventType eq "user.session.start" and outcome.result eq "FAILURE" for failed sign-ins.\n3. Narrow to one person or origin by adding actor.alternateId or client.ipAddress to the filter, or use the keyword query for a free-text sweep.\n4. Read outcomeReason, clientIpAddress, and the client geography on each event to separate a wrong password from an unexpected location.\n5. Page with the returned cursor while hasMore is true when the window is wide.\n\n## Output\nA short timeline of the matching events with actor, time, outcome, reason, and source IP, plus a plain statement of the likely cause.',
    },
    {
      name: 'review-app-access',
      description: 'Audit who can reach an Okta application through direct and group assignments.',
      content:
        '# Review Application Access\n\nEstablish who has access to an application and how they got it.\n\n## Steps\n1. Run List Applications to resolve the application id, or Get Application when the id is known.\n2. Run List Application Users and read the scope on each assignment: USER means a direct grant, GROUP means it was inherited.\n3. Run List Application Groups to see which groups confer access, since every member of those groups reaches the app.\n4. Expand any group of interest with List Group Members to get the real roster.\n5. Revoke with Remove User from Application for a direct grant, or Remove Group from Application to cut the whole group.\n\n## Output\nA roster split into direct and group-inherited access, naming the groups that grant it, and a list of assignments that look unjustified.',
    },
    {
      name: 'reset-user-password',
      description: 'Trigger an Okta password reset for a user who is locked out.',
      content:
        '# Reset User Password\n\nHelp a user regain access by resetting their Okta password.\n\n## Steps\n1. Locate the user with Get User to confirm identity.\n2. Run Reset Password to start the reset flow for that user.\n3. If the account is suspended, run Unsuspend User first so the reset can proceed.\n\n## Output\nConfirm the reset was initiated for the named user and note any prerequisite step that was taken.',
    },
  ],
} as const satisfies BlockMeta
