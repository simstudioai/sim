import { IAMIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { IAMBaseResponse } from '@/tools/iam/types'

export const IAMBlock: BlockConfig<IAMBaseResponse> = {
  type: 'iam',
  name: 'AWS IAM',
  description: 'Manage AWS IAM users, roles, policies, and groups',
  longDescription:
    'Integrate AWS Identity and Access Management into your workflow. Create and manage users, roles, policies, groups, and access keys.',
  docsLink: 'https://docs.sim.ai/tools/iam',
  category: 'tools',
  integrationType: IntegrationType.DeveloperTools,
  tags: ['cloud', 'identity'],
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: IAMIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Create User', id: 'create_user' },
        { label: 'Delete User', id: 'delete_user' },
        { label: 'List Roles', id: 'list_roles' },
        { label: 'Get Role', id: 'get_role' },
        { label: 'Create Role', id: 'create_role' },
        { label: 'Delete Role', id: 'delete_role' },
        { label: 'Attach User Policy', id: 'attach_user_policy' },
        { label: 'Detach User Policy', id: 'detach_user_policy' },
        { label: 'Attach Role Policy', id: 'attach_role_policy' },
        { label: 'Detach Role Policy', id: 'detach_role_policy' },
        { label: 'List Policies', id: 'list_policies' },
        { label: 'Create Access Key', id: 'create_access_key' },
        { label: 'Delete Access Key', id: 'delete_access_key' },
        { label: 'List Groups', id: 'list_groups' },
        { label: 'Add User to Group', id: 'add_user_to_group' },
        { label: 'Remove User from Group', id: 'remove_user_from_group' },
        { label: 'List Attached Role Policies', id: 'list_attached_role_policies' },
        { label: 'List Attached User Policies', id: 'list_attached_user_policies' },
        { label: 'Simulate Principal Policy', id: 'simulate_principal_policy' },
      ],
      value: () => 'list_users',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'userName',
      title: 'User Name',
      type: 'short-input',
      placeholder: 'my-iam-user',
      condition: {
        field: 'operation',
        value: [
          'get_user',
          'create_user',
          'delete_user',
          'attach_user_policy',
          'detach_user_policy',
          'create_access_key',
          'delete_access_key',
          'add_user_to_group',
          'remove_user_from_group',
          'list_attached_user_policies',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_user',
          'create_user',
          'delete_user',
          'attach_user_policy',
          'detach_user_policy',
          'add_user_to_group',
          'remove_user_from_group',
          'list_attached_user_policies',
        ],
      },
    },
    {
      id: 'roleName',
      title: 'Role Name',
      type: 'short-input',
      placeholder: 'my-iam-role',
      condition: {
        field: 'operation',
        value: [
          'get_role',
          'create_role',
          'delete_role',
          'attach_role_policy',
          'detach_role_policy',
          'list_attached_role_policies',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_role',
          'create_role',
          'delete_role',
          'attach_role_policy',
          'detach_role_policy',
          'list_attached_role_policies',
        ],
      },
    },
    {
      id: 'policyArn',
      title: 'Policy ARN',
      type: 'short-input',
      placeholder: 'arn:aws:iam::aws:policy/ReadOnlyAccess',
      condition: {
        field: 'operation',
        value: [
          'attach_user_policy',
          'detach_user_policy',
          'attach_role_policy',
          'detach_role_policy',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'attach_user_policy',
          'detach_user_policy',
          'attach_role_policy',
          'detach_role_policy',
        ],
      },
    },
    {
      id: 'assumeRolePolicyDocument',
      title: 'Trust Policy (JSON)',
      type: 'code',
      placeholder:
        '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}',
      condition: { field: 'operation', value: 'create_role' },
      required: { field: 'operation', value: 'create_role' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an AWS IAM trust policy JSON document. The policy should use Version "2012-10-17" and contain a Statement array with Effect, Principal, and Action fields. Return ONLY the JSON - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'my-iam-group',
      condition: {
        field: 'operation',
        value: ['add_user_to_group', 'remove_user_from_group'],
      },
      required: {
        field: 'operation',
        value: ['add_user_to_group', 'remove_user_from_group'],
      },
    },
    {
      id: 'accessKeyIdToDelete',
      title: 'Access Key ID to Delete',
      type: 'short-input',
      placeholder: 'AKIA...',
      condition: { field: 'operation', value: 'delete_access_key' },
      required: { field: 'operation', value: 'delete_access_key' },
    },
    {
      id: 'path',
      title: 'Path',
      type: 'short-input',
      placeholder: '/division_abc/',
      condition: { field: 'operation', value: ['create_user', 'create_role'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Role description',
      condition: { field: 'operation', value: 'create_role' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'maxSessionDuration',
      title: 'Max Session Duration (seconds)',
      type: 'short-input',
      placeholder: '3600',
      condition: { field: 'operation', value: 'create_role' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'scope',
      title: 'Policy Scope',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'All' },
        { label: 'AWS Managed', id: 'AWS' },
        { label: 'Customer Managed', id: 'Local' },
      ],
      value: () => 'All',
      condition: { field: 'operation', value: 'list_policies' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'onlyAttached',
      title: 'Only Attached',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_policies' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'policySourceArn',
      title: 'Principal ARN',
      type: 'short-input',
      placeholder: 'arn:aws:iam::123456789012:user/alice',
      condition: { field: 'operation', value: 'simulate_principal_policy' },
      required: { field: 'operation', value: 'simulate_principal_policy' },
    },
    {
      id: 'actionNames',
      title: 'Actions (comma-separated)',
      type: 'short-input',
      placeholder: 's3:GetObject,ec2:DescribeInstances',
      condition: { field: 'operation', value: 'simulate_principal_policy' },
      required: { field: 'operation', value: 'simulate_principal_policy' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of AWS IAM action names to simulate (e.g., s3:GetObject,ec2:DescribeInstances,iam:ListUsers). Return ONLY the comma-separated list - no explanations, no extra text.',
        placeholder: 'Describe the actions you want to check',
      },
    },
    {
      id: 'resourceArns',
      title: 'Resource ARNs (comma-separated)',
      type: 'short-input',
      placeholder: 'arn:aws:s3:::my-bucket/*',
      condition: { field: 'operation', value: 'simulate_principal_policy' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'pathPrefix',
      title: 'Path Prefix',
      type: 'short-input',
      placeholder: '/division_abc/',
      condition: {
        field: 'operation',
        value: [
          'list_users',
          'list_roles',
          'list_policies',
          'list_groups',
          'list_attached_role_policies',
          'list_attached_user_policies',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: [
          'list_users',
          'list_roles',
          'list_policies',
          'list_groups',
          'list_attached_role_policies',
          'list_attached_user_policies',
          'simulate_principal_policy',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'marker',
      title: 'Pagination Marker',
      type: 'short-input',
      placeholder: 'Pagination marker',
      condition: {
        field: 'operation',
        value: [
          'list_users',
          'list_roles',
          'list_policies',
          'list_groups',
          'list_attached_role_policies',
          'list_attached_user_policies',
          'simulate_principal_policy',
        ],
      },
      required: false,
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'iam_list_users',
      'iam_get_user',
      'iam_create_user',
      'iam_delete_user',
      'iam_list_roles',
      'iam_get_role',
      'iam_create_role',
      'iam_delete_role',
      'iam_attach_user_policy',
      'iam_detach_user_policy',
      'iam_attach_role_policy',
      'iam_detach_role_policy',
      'iam_list_policies',
      'iam_create_access_key',
      'iam_delete_access_key',
      'iam_list_groups',
      'iam_add_user_to_group',
      'iam_remove_user_from_group',
      'iam_list_attached_role_policies',
      'iam_list_attached_user_policies',
      'iam_simulate_principal_policy',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list_users':
            return 'iam_list_users'
          case 'get_user':
            return 'iam_get_user'
          case 'create_user':
            return 'iam_create_user'
          case 'delete_user':
            return 'iam_delete_user'
          case 'list_roles':
            return 'iam_list_roles'
          case 'get_role':
            return 'iam_get_role'
          case 'create_role':
            return 'iam_create_role'
          case 'delete_role':
            return 'iam_delete_role'
          case 'attach_user_policy':
            return 'iam_attach_user_policy'
          case 'detach_user_policy':
            return 'iam_detach_user_policy'
          case 'attach_role_policy':
            return 'iam_attach_role_policy'
          case 'detach_role_policy':
            return 'iam_detach_role_policy'
          case 'list_policies':
            return 'iam_list_policies'
          case 'create_access_key':
            return 'iam_create_access_key'
          case 'delete_access_key':
            return 'iam_delete_access_key'
          case 'list_groups':
            return 'iam_list_groups'
          case 'add_user_to_group':
            return 'iam_add_user_to_group'
          case 'remove_user_from_group':
            return 'iam_remove_user_from_group'
          case 'list_attached_role_policies':
            return 'iam_list_attached_role_policies'
          case 'list_attached_user_policies':
            return 'iam_list_attached_user_policies'
          case 'simulate_principal_policy':
            return 'iam_simulate_principal_policy'
          default:
            throw new Error(`Invalid IAM operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, maxItems, maxSessionDuration, onlyAttached, resourceArns, ...rest } =
          params

        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        const result: Record<string, unknown> = { ...connectionConfig }

        switch (operation) {
          case 'list_users':
          case 'list_roles':
          case 'list_groups':
            if (rest.pathPrefix) result.pathPrefix = rest.pathPrefix
            if (maxItems) {
              const parsed = Number.parseInt(String(maxItems), 10)
              if (!Number.isNaN(parsed)) result.maxItems = parsed
            }
            if (rest.marker) result.marker = rest.marker
            break
          case 'get_user':
          case 'delete_user':
            result.userName = rest.userName
            break
          case 'create_user':
            result.userName = rest.userName
            if (rest.path) result.path = rest.path
            break
          case 'get_role':
          case 'delete_role':
            result.roleName = rest.roleName
            break
          case 'create_role':
            result.roleName = rest.roleName
            result.assumeRolePolicyDocument = rest.assumeRolePolicyDocument
            if (rest.description) result.description = rest.description
            if (rest.path) result.path = rest.path
            if (maxSessionDuration) {
              const parsed = Number.parseInt(String(maxSessionDuration), 10)
              if (!Number.isNaN(parsed)) result.maxSessionDuration = parsed
            }
            break
          case 'attach_user_policy':
          case 'detach_user_policy':
            result.userName = rest.userName
            result.policyArn = rest.policyArn
            break
          case 'attach_role_policy':
          case 'detach_role_policy':
            result.roleName = rest.roleName
            result.policyArn = rest.policyArn
            break
          case 'list_policies':
            if (rest.scope) result.scope = rest.scope
            if (onlyAttached === 'true' || onlyAttached === true) result.onlyAttached = true
            if (rest.pathPrefix) result.pathPrefix = rest.pathPrefix
            if (maxItems) {
              const parsed = Number.parseInt(String(maxItems), 10)
              if (!Number.isNaN(parsed)) result.maxItems = parsed
            }
            if (rest.marker) result.marker = rest.marker
            break
          case 'create_access_key':
            if (rest.userName) result.userName = rest.userName
            break
          case 'delete_access_key':
            result.accessKeyIdToDelete = rest.accessKeyIdToDelete
            if (rest.userName) result.userName = rest.userName
            break
          case 'add_user_to_group':
          case 'remove_user_from_group':
            result.userName = rest.userName
            result.groupName = rest.groupName
            break
          case 'list_attached_role_policies':
            result.roleName = rest.roleName
            if (rest.pathPrefix) result.pathPrefix = rest.pathPrefix
            if (maxItems) {
              const parsed = Number.parseInt(String(maxItems), 10)
              if (!Number.isNaN(parsed)) result.maxItems = parsed
            }
            if (rest.marker) result.marker = rest.marker
            break
          case 'list_attached_user_policies':
            result.userName = rest.userName
            if (rest.pathPrefix) result.pathPrefix = rest.pathPrefix
            if (maxItems) {
              const parsed = Number.parseInt(String(maxItems), 10)
              if (!Number.isNaN(parsed)) result.maxItems = parsed
            }
            if (rest.marker) result.marker = rest.marker
            break
          case 'simulate_principal_policy':
            result.policySourceArn = rest.policySourceArn
            result.actionNames = rest.actionNames
            if (resourceArns) result.resourceArns = resourceArns
            if (maxItems) {
              const parsed = Number.parseInt(String(maxItems), 10)
              if (!Number.isNaN(parsed)) result.maxResults = parsed
            }
            if (rest.marker) result.marker = rest.marker
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'IAM operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    userName: { type: 'string', description: 'IAM user name' },
    roleName: { type: 'string', description: 'IAM role name' },
    policyArn: { type: 'string', description: 'Policy ARN' },
    assumeRolePolicyDocument: { type: 'string', description: 'Trust policy JSON' },
    groupName: { type: 'string', description: 'IAM group name' },
    accessKeyIdToDelete: { type: 'string', description: 'Access key ID to delete' },
    path: { type: 'string', description: 'Resource path' },
    description: { type: 'string', description: 'Role description' },
    maxSessionDuration: { type: 'number', description: 'Max session duration in seconds' },
    scope: { type: 'string', description: 'Policy scope filter (All, AWS, Local)' },
    onlyAttached: { type: 'string', description: 'Only return attached policies' },
    pathPrefix: { type: 'string', description: 'Path prefix filter' },
    maxItems: { type: 'number', description: 'Maximum number of items to return' },
    marker: { type: 'string', description: 'Pagination marker' },
    policySourceArn: { type: 'string', description: 'ARN of the principal to simulate' },
    actionNames: { type: 'string', description: 'Comma-separated AWS actions to simulate' },
    resourceArns: {
      type: 'string',
      description: 'Comma-separated resource ARNs to simulate against',
    },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Operation status message',
    },
    users: {
      type: 'json',
      description: 'List of IAM users (userName, userId, arn, path, createDate, passwordLastUsed)',
    },
    roles: {
      type: 'json',
      description:
        'List of IAM roles (roleName, roleId, arn, path, createDate, description, maxSessionDuration)',
    },
    policies: {
      type: 'json',
      description:
        'List of IAM policies (policyName, policyId, arn, path, attachmentCount, isAttachable, createDate, updateDate)',
    },
    groups: {
      type: 'json',
      description: 'List of IAM groups (groupName, groupId, arn, path, createDate)',
    },
    userName: {
      type: 'string',
      description: 'User name',
    },
    userId: {
      type: 'string',
      description: 'User ID',
    },
    roleName: {
      type: 'string',
      description: 'Role name',
    },
    roleId: {
      type: 'string',
      description: 'Role ID',
    },
    arn: {
      type: 'string',
      description: 'Resource ARN',
    },
    path: {
      type: 'string',
      description: 'Resource path',
    },
    createDate: {
      type: 'string',
      description: 'Creation date',
    },
    passwordLastUsed: {
      type: 'string',
      description: 'Date password was last used',
    },
    permissionsBoundaryArn: {
      type: 'string',
      description: 'ARN of the permissions boundary policy',
    },
    tags: {
      type: 'json',
      description: 'Tags attached to the resource (key, value pairs)',
    },
    description: {
      type: 'string',
      description: 'Role description',
    },
    maxSessionDuration: {
      type: 'number',
      description: 'Maximum session duration in seconds',
    },
    assumeRolePolicyDocument: {
      type: 'string',
      description: 'Trust policy document (JSON)',
    },
    roleLastUsedDate: {
      type: 'string',
      description: 'Date the role was last used',
    },
    roleLastUsedRegion: {
      type: 'string',
      description: 'AWS region where the role was last used',
    },
    accessKeyId: {
      type: 'string',
      description: 'Access key ID',
    },
    secretAccessKey: {
      type: 'string',
      description: 'Secret access key (only shown once)',
    },
    status: {
      type: 'string',
      description: 'Access key status',
    },
    isTruncated: {
      type: 'boolean',
      description: 'Whether there are more results',
    },
    marker: {
      type: 'string',
      description: 'Pagination marker',
    },
    count: {
      type: 'number',
      description: 'Number of items returned',
    },
    attachedPolicies: {
      type: 'json',
      description: 'List of attached managed policies with policyName and policyArn',
    },
    evaluationResults: {
      type: 'json',
      description:
        'Policy simulation results per action: evalActionName, evalResourceName, evalDecision (allowed/explicitDeny/implicitDeny), matchedStatements (sourcePolicyId, sourcePolicyType), missingContextValues',
    },
  },
}
