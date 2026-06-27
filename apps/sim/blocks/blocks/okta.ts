import { OktaIcon } from '@/components/icons'
import { OktaBlockDisplay } from '@/blocks/blocks/okta.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import type { OktaResponse } from '@/tools/okta/types'

export const OktaBlock: BlockConfig<OktaResponse> = {
  ...OktaBlockDisplay,
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
      condition: { field: 'operation', value: ['okta_list_users', 'okta_list_groups'] },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'status eq "ACTIVE"',
      condition: { field: 'operation', value: ['okta_list_users', 'okta_list_groups'] },
      mode: 'advanced',
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
    {
      id: 'activate',
      title: 'Activate Immediately',
      type: 'switch',
      condition: { field: 'operation', value: 'okta_create_user' },
      mode: 'advanced',
    },
    // Group name (for create/update group)
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'Engineering Team',
      condition: { field: 'operation', value: ['okta_create_group', 'okta_update_group'] },
      required: { field: 'operation', value: ['okta_create_group', 'okta_update_group'] },
    },
    {
      id: 'groupDescription',
      title: 'Group Description',
      type: 'short-input',
      placeholder: 'Description for the group',
      condition: { field: 'operation', value: ['okta_create_group', 'okta_update_group'] },
    },
    // Send email option (activate, reset password, delete)
    {
      id: 'sendEmail',
      title: 'Send Email',
      type: 'switch',
      condition: {
        field: 'operation',
        value: [
          'okta_activate_user',
          'okta_deactivate_user',
          'okta_reset_password',
          'okta_delete_user',
        ],
      },
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
        value: ['okta_list_users', 'okta_list_groups', 'okta_list_group_members'],
      },
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
    ],
    config: {
      tool: (params) => params.operation as string,
      params: (params) => {
        const result: Record<string, unknown> = {
          apiKey: params.apiKey,
          domain: params.domain,
        }

        if (params.limit) result.limit = Number(params.limit)

        // Map group-specific UI fields to tool param names
        if (params.groupName) result.name = params.groupName
        if (params.groupDescription !== undefined) result.description = params.groupDescription

        // Pass through all other params, skipping empty values. Blank fields in a
        // partial update (e.g. update_user, a POST merge) must be omitted so they
        // leave the existing Okta value unchanged rather than overwriting it with
        // an empty string. This mirrors the agent tool-call path, which already
        // filters empty params before execution.
        const skipKeys = new Set([
          'operation',
          'apiKey',
          'domain',
          'limit',
          'groupName',
          'groupDescription',
        ])
        for (const [key, value] of Object.entries(params)) {
          if (!skipKeys.has(key) && value !== undefined && value !== null && value !== '') {
            result[key] = value
          }
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
    groupName: { type: 'string', description: 'Group name' },
    groupDescription: { type: 'string', description: 'Group description' },
    sendEmail: { type: 'boolean', description: 'Whether to send email notification' },
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
    count: { type: 'number', description: 'Number of results' },
    added: { type: 'boolean', description: 'Whether user was added to group' },
    removed: { type: 'boolean', description: 'Whether user was removed from group' },
    deactivated: { type: 'boolean', description: 'Whether user was deactivated' },
    suspended: { type: 'boolean', description: 'Whether user was suspended' },
    unsuspended: { type: 'boolean', description: 'Whether user was unsuspended' },
    activated: { type: 'boolean', description: 'Whether user was activated' },
    deleted: { type: 'boolean', description: 'Whether resource was deleted' },
    activationUrl: { type: 'string', description: 'Activation URL (when sendEmail is false)' },
    activationToken: { type: 'string', description: 'Activation token (when sendEmail is false)' },
    resetPasswordUrl: {
      type: 'string',
      description: 'Password reset URL (when sendEmail is false)',
    },
    created: { type: 'string', description: 'Creation timestamp' },
    lastUpdated: { type: 'string', description: 'Last update timestamp' },
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
      name: 'reset-user-password',
      description: 'Trigger an Okta password reset for a user who is locked out.',
      content:
        '# Reset User Password\n\nHelp a user regain access by resetting their Okta password.\n\n## Steps\n1. Locate the user with Get User to confirm identity.\n2. Run Reset Password to start the reset flow for that user.\n3. If the account is suspended, run Unsuspend User first so the reset can proceed.\n\n## Output\nConfirm the reset was initiated for the named user and note any prerequisite step that was taken.',
    },
  ],
} as const satisfies BlockMeta
