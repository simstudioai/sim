import { IdentityCenterIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { IdentityCenterBaseResponse } from '@/tools/identity_center/types'

export const IdentityCenterBlock: BlockConfig<IdentityCenterBaseResponse> = {
  type: 'identity_center',
  name: 'AWS Identity Center',
  description: 'Manage temporary elevated access in AWS IAM Identity Center',
  longDescription:
    'Provision and revoke temporary access to AWS accounts via IAM Identity Center (SSO). Assign permission sets to users or groups, look up users by email, and list accounts and permission sets for access request workflows.',
  docsLink: 'https://docs.sim.ai/tools/identity-center',
  category: 'tools',
  integrationType: IntegrationType.Security,
  tags: ['cloud', 'identity'],
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: IdentityCenterIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Instances', id: 'list_instances' },
        { label: 'List Accounts', id: 'list_accounts' },
        { label: 'Describe Account', id: 'describe_account' },
        { label: 'List Permission Sets', id: 'list_permission_sets' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Get Group', id: 'get_group' },
        { label: 'List Groups', id: 'list_groups' },
        { label: 'Create Account Assignment', id: 'create_account_assignment' },
        { label: 'Delete Account Assignment', id: 'delete_account_assignment' },
        { label: 'Check Assignment Status', id: 'check_assignment_status' },
        { label: 'Check Assignment Deletion Status', id: 'check_assignment_deletion_status' },
        { label: 'List Account Assignments', id: 'list_account_assignments' },
      ],
      value: () => 'list_instances',
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
      id: 'instanceArn',
      title: 'Instance ARN',
      type: 'short-input',
      placeholder: 'arn:aws:sso:::instance/ssoins-...',
      condition: {
        field: 'operation',
        value: [
          'list_instances',
          'list_accounts',
          'get_user',
          'get_group',
          'describe_account',
          'list_groups',
        ],
        not: true,
      },
      required: {
        field: 'operation',
        value: [
          'list_instances',
          'list_accounts',
          'get_user',
          'get_group',
          'describe_account',
          'list_groups',
        ],
        not: true,
      },
    },
    {
      id: 'identityStoreId',
      title: 'Identity Store ID',
      type: 'short-input',
      placeholder: 'd-1234567890',
      condition: { field: 'operation', value: ['get_user', 'get_group', 'list_groups'] },
      required: { field: 'operation', value: ['get_user', 'get_group', 'list_groups'] },
    },
    {
      id: 'email',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: { field: 'operation', value: 'get_user' },
      required: { field: 'operation', value: 'get_user' },
    },
    {
      id: 'displayName',
      title: 'Group Display Name',
      type: 'short-input',
      placeholder: 'Engineering-Admins',
      condition: { field: 'operation', value: 'get_group' },
      required: { field: 'operation', value: 'get_group' },
    },
    {
      id: 'accountId',
      title: 'AWS Account ID',
      type: 'short-input',
      placeholder: '123456789012',
      condition: {
        field: 'operation',
        value: ['create_account_assignment', 'delete_account_assignment', 'describe_account'],
      },
      required: {
        field: 'operation',
        value: ['create_account_assignment', 'delete_account_assignment', 'describe_account'],
      },
    },
    {
      id: 'permissionSetArn',
      title: 'Permission Set ARN',
      type: 'short-input',
      placeholder: 'arn:aws:sso:::permissionSet/ssoins-.../ps-...',
      condition: {
        field: 'operation',
        value: ['create_account_assignment', 'delete_account_assignment'],
      },
      required: {
        field: 'operation',
        value: ['create_account_assignment', 'delete_account_assignment'],
      },
    },
    {
      id: 'principalType',
      title: 'Principal Type',
      type: 'dropdown',
      options: [
        { label: 'User', id: 'USER' },
        { label: 'Group', id: 'GROUP' },
      ],
      value: () => 'USER',
      condition: {
        field: 'operation',
        value: [
          'create_account_assignment',
          'delete_account_assignment',
          'list_account_assignments',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_account_assignment',
          'delete_account_assignment',
          'list_account_assignments',
        ],
      },
    },
    {
      id: 'principalId',
      title: 'Principal ID',
      type: 'short-input',
      placeholder: 'Identity Store user or group ID',
      condition: {
        field: 'operation',
        value: [
          'create_account_assignment',
          'delete_account_assignment',
          'list_account_assignments',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_account_assignment',
          'delete_account_assignment',
          'list_account_assignments',
        ],
      },
    },
    {
      id: 'requestId',
      title: 'Request ID',
      type: 'short-input',
      placeholder: 'Request ID from Create or Delete Assignment',
      condition: {
        field: 'operation',
        value: ['check_assignment_status', 'check_assignment_deletion_status'],
      },
      required: {
        field: 'operation',
        value: ['check_assignment_status', 'check_assignment_deletion_status'],
      },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '20',
      condition: {
        field: 'operation',
        value: [
          'list_instances',
          'list_accounts',
          'list_permission_sets',
          'list_account_assignments',
          'list_groups',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Pagination Token',
      type: 'short-input',
      placeholder: 'Next page token from previous request',
      condition: {
        field: 'operation',
        value: [
          'list_instances',
          'list_accounts',
          'list_permission_sets',
          'list_account_assignments',
          'list_groups',
        ],
      },
      required: false,
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'identity_center_list_instances',
      'identity_center_list_accounts',
      'identity_center_describe_account',
      'identity_center_list_permission_sets',
      'identity_center_get_user',
      'identity_center_get_group',
      'identity_center_list_groups',
      'identity_center_create_account_assignment',
      'identity_center_delete_account_assignment',
      'identity_center_check_assignment_status',
      'identity_center_check_assignment_deletion_status',
      'identity_center_list_account_assignments',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list_instances':
            return 'identity_center_list_instances'
          case 'list_accounts':
            return 'identity_center_list_accounts'
          case 'describe_account':
            return 'identity_center_describe_account'
          case 'list_permission_sets':
            return 'identity_center_list_permission_sets'
          case 'get_user':
            return 'identity_center_get_user'
          case 'get_group':
            return 'identity_center_get_group'
          case 'list_groups':
            return 'identity_center_list_groups'
          case 'create_account_assignment':
            return 'identity_center_create_account_assignment'
          case 'delete_account_assignment':
            return 'identity_center_delete_account_assignment'
          case 'check_assignment_status':
            return 'identity_center_check_assignment_status'
          case 'check_assignment_deletion_status':
            return 'identity_center_check_assignment_deletion_status'
          case 'list_account_assignments':
            return 'identity_center_list_account_assignments'
          default:
            throw new Error(`Invalid Identity Center operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, maxResults, ...rest } = params

        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        const result: Record<string, unknown> = { ...connectionConfig }

        switch (operation) {
          case 'list_instances':
            if (maxResults) {
              const parsed = Number.parseInt(String(maxResults), 10)
              if (!Number.isNaN(parsed)) result.maxResults = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'list_accounts':
            if (maxResults) {
              const parsed = Number.parseInt(String(maxResults), 10)
              if (!Number.isNaN(parsed)) result.maxResults = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'describe_account':
            result.accountId = rest.accountId
            break
          case 'list_permission_sets':
            result.instanceArn = rest.instanceArn
            if (maxResults) {
              const parsed = Number.parseInt(String(maxResults), 10)
              if (!Number.isNaN(parsed)) result.maxResults = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'get_user':
            result.identityStoreId = rest.identityStoreId
            result.email = rest.email
            break
          case 'get_group':
            result.identityStoreId = rest.identityStoreId
            result.displayName = rest.displayName
            break
          case 'list_groups':
            result.identityStoreId = rest.identityStoreId
            if (maxResults) {
              const parsed = Number.parseInt(String(maxResults), 10)
              if (!Number.isNaN(parsed)) result.maxResults = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'create_account_assignment':
          case 'delete_account_assignment':
            result.instanceArn = rest.instanceArn
            result.accountId = rest.accountId
            result.permissionSetArn = rest.permissionSetArn
            result.principalType = rest.principalType
            result.principalId = rest.principalId
            break
          case 'check_assignment_status':
          case 'check_assignment_deletion_status':
            result.instanceArn = rest.instanceArn
            result.requestId = rest.requestId
            break
          case 'list_account_assignments':
            result.instanceArn = rest.instanceArn
            result.principalId = rest.principalId
            result.principalType = rest.principalType
            if (maxResults) {
              const parsed = Number.parseInt(String(maxResults), 10)
              if (!Number.isNaN(parsed)) result.maxResults = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Identity Center operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    instanceArn: { type: 'string', description: 'Identity Center instance ARN' },
    identityStoreId: { type: 'string', description: 'Identity Store ID' },
    email: { type: 'string', description: 'User email address' },
    displayName: { type: 'string', description: 'Group display name' },
    accountId: { type: 'string', description: 'AWS account ID' },
    permissionSetArn: { type: 'string', description: 'Permission set ARN' },
    principalType: { type: 'string', description: 'Principal type: USER or GROUP' },
    principalId: { type: 'string', description: 'Identity Store user or group ID' },
    requestId: { type: 'string', description: 'Assignment creation/deletion request ID' },
    maxResults: { type: 'number', description: 'Maximum number of results to return' },
    nextToken: { type: 'string', description: 'Pagination token from previous request' },
  },
  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    instances: {
      type: 'json',
      description:
        'List of Identity Center instances (instanceArn, identityStoreId, name, status, statusReason)',
    },
    accounts: {
      type: 'json',
      description: 'List of AWS accounts (id, arn, name, email, status)',
    },
    permissionSets: {
      type: 'json',
      description: 'List of permission sets (permissionSetArn, name, description, sessionDuration)',
    },
    groups: {
      type: 'json',
      description: 'List of Identity Store groups (groupId, displayName, description)',
    },
    userId: { type: 'string', description: 'Identity Store user ID (use as principalId)' },
    userName: { type: 'string', description: 'Username in the Identity Store' },
    displayName: { type: 'string', description: 'Display name of the user or group' },
    email: { type: 'string', description: 'Email address of the user' },
    groupId: { type: 'string', description: 'Identity Store group ID (use as principalId)' },
    description: { type: 'string', description: 'Group description' },
    id: { type: 'string', description: 'AWS account ID (from describe_account)' },
    arn: { type: 'string', description: 'AWS account ARN' },
    name: { type: 'string', description: 'AWS account name' },
    status: {
      type: 'string',
      description:
        'Assignment provisioning status (IN_PROGRESS, FAILED, SUCCEEDED) or account status',
    },
    requestId: { type: 'string', description: 'Request ID for polling assignment status' },
    accountId: { type: 'string', description: 'Target AWS account ID' },
    permissionSetArn: { type: 'string', description: 'Permission set ARN' },
    principalType: { type: 'string', description: 'Principal type (USER or GROUP)' },
    principalId: { type: 'string', description: 'Principal ID' },
    failureReason: { type: 'string', description: 'Failure reason if status is FAILED' },
    createdDate: { type: 'string', description: 'Date the request was created' },
    joinedTimestamp: { type: 'string', description: 'Date the account joined the organization' },
    assignments: {
      type: 'json',
      description:
        'List of account assignments (accountId, permissionSetArn, principalType, principalId)',
    },
    nextToken: { type: 'string', description: 'Pagination token for the next page' },
    count: { type: 'number', description: 'Number of items returned' },
  },
}
