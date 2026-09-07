import { awsIamAddUserToGroupContract } from '@/lib/api/contracts/tools/aws/iam-add-user-to-group'
import { awsIamAttachRolePolicyContract } from '@/lib/api/contracts/tools/aws/iam-attach-role-policy'
import { awsIamAttachUserPolicyContract } from '@/lib/api/contracts/tools/aws/iam-attach-user-policy'
import { awsIamCreateAccessKeyContract } from '@/lib/api/contracts/tools/aws/iam-create-access-key'
import { awsIamCreateRoleContract } from '@/lib/api/contracts/tools/aws/iam-create-role'
import { awsIamCreateUserContract } from '@/lib/api/contracts/tools/aws/iam-create-user'
import { awsIamDeleteAccessKeyContract } from '@/lib/api/contracts/tools/aws/iam-delete-access-key'
import { awsIamDeleteRoleContract } from '@/lib/api/contracts/tools/aws/iam-delete-role'
import { awsIamDeleteUserContract } from '@/lib/api/contracts/tools/aws/iam-delete-user'
import { awsIamDetachRolePolicyContract } from '@/lib/api/contracts/tools/aws/iam-detach-role-policy'
import { awsIamDetachUserPolicyContract } from '@/lib/api/contracts/tools/aws/iam-detach-user-policy'
import { awsIamGetPolicyContract } from '@/lib/api/contracts/tools/aws/iam-get-policy'
import { awsIamGetRoleContract } from '@/lib/api/contracts/tools/aws/iam-get-role'
import { awsIamGetUserContract } from '@/lib/api/contracts/tools/aws/iam-get-user'
import { awsIamListAccessKeysContract } from '@/lib/api/contracts/tools/aws/iam-list-access-keys'
import { awsIamListAttachedRolePoliciesContract } from '@/lib/api/contracts/tools/aws/iam-list-attached-role-policies'
import { awsIamListAttachedUserPoliciesContract } from '@/lib/api/contracts/tools/aws/iam-list-attached-user-policies'
import { awsIamListGroupsContract } from '@/lib/api/contracts/tools/aws/iam-list-groups'
import { awsIamListPoliciesContract } from '@/lib/api/contracts/tools/aws/iam-list-policies'
import { awsIamListRolesContract } from '@/lib/api/contracts/tools/aws/iam-list-roles'
import { awsIamListUsersContract } from '@/lib/api/contracts/tools/aws/iam-list-users'
import { awsIamRemoveUserFromGroupContract } from '@/lib/api/contracts/tools/aws/iam-remove-user-from-group'
import { awsIamSimulatePrincipalPolicyContract } from '@/lib/api/contracts/tools/aws/iam-simulate-principal-policy'
import { awsIamUpdateAccessKeyContract } from '@/lib/api/contracts/tools/aws/iam-update-access-key'
import {
  executeIamAddUserToGroup,
  executeIamAttachRolePolicy,
  executeIamAttachUserPolicy,
  executeIamCreateAccessKey,
  executeIamCreateRole,
  executeIamCreateUser,
  executeIamDeleteAccessKey,
  executeIamDeleteRole,
  executeIamDeleteUser,
  executeIamDetachRolePolicy,
  executeIamDetachUserPolicy,
  executeIamGetPolicy,
  executeIamGetRole,
  executeIamGetUser,
  executeIamListAccessKeys,
  executeIamListAttachedRolePolicies,
  executeIamListAttachedUserPolicies,
  executeIamListGroups,
  executeIamListPolicies,
  executeIamListRoles,
  executeIamListUsers,
  executeIamRemoveUserFromGroup,
  executeIamSimulatePrincipalPolicy,
  executeIamUpdateAccessKey,
} from '@/lib/internal/iam/operations'
import { executeInternalJsonToolOperation } from '@/lib/internal/tool-operations/execute-json-operation'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeIamTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'iam_add_user_to_group':
      return executeInternalJsonToolOperation(
        awsIamAddUserToGroupContract,
        input,
        executeIamAddUserToGroup,
        'Failed to add user to group',
        signal
      )
    case 'iam_attach_role_policy':
      return executeInternalJsonToolOperation(
        awsIamAttachRolePolicyContract,
        input,
        executeIamAttachRolePolicy,
        'Failed to attach role policy',
        signal
      )
    case 'iam_attach_user_policy':
      return executeInternalJsonToolOperation(
        awsIamAttachUserPolicyContract,
        input,
        executeIamAttachUserPolicy,
        'Failed to attach user policy',
        signal
      )
    case 'iam_create_access_key':
      return executeInternalJsonToolOperation(
        awsIamCreateAccessKeyContract,
        input,
        executeIamCreateAccessKey,
        'Failed to create access key',
        signal
      )
    case 'iam_create_role':
      return executeInternalJsonToolOperation(
        awsIamCreateRoleContract,
        input,
        executeIamCreateRole,
        'Failed to create IAM role',
        signal
      )
    case 'iam_create_user':
      return executeInternalJsonToolOperation(
        awsIamCreateUserContract,
        input,
        executeIamCreateUser,
        'Failed to create IAM user',
        signal
      )
    case 'iam_delete_access_key':
      return executeInternalJsonToolOperation(
        awsIamDeleteAccessKeyContract,
        input,
        executeIamDeleteAccessKey,
        'Failed to delete access key',
        signal
      )
    case 'iam_delete_role':
      return executeInternalJsonToolOperation(
        awsIamDeleteRoleContract,
        input,
        executeIamDeleteRole,
        'Failed to delete IAM role',
        signal
      )
    case 'iam_delete_user':
      return executeInternalJsonToolOperation(
        awsIamDeleteUserContract,
        input,
        executeIamDeleteUser,
        'Failed to delete IAM user',
        signal
      )
    case 'iam_detach_role_policy':
      return executeInternalJsonToolOperation(
        awsIamDetachRolePolicyContract,
        input,
        executeIamDetachRolePolicy,
        'Failed to detach role policy',
        signal
      )
    case 'iam_detach_user_policy':
      return executeInternalJsonToolOperation(
        awsIamDetachUserPolicyContract,
        input,
        executeIamDetachUserPolicy,
        'Failed to detach user policy',
        signal
      )
    case 'iam_get_policy':
      return executeInternalJsonToolOperation(
        awsIamGetPolicyContract,
        input,
        executeIamGetPolicy,
        'Failed to get IAM policy',
        signal
      )
    case 'iam_get_role':
      return executeInternalJsonToolOperation(
        awsIamGetRoleContract,
        input,
        executeIamGetRole,
        'Failed to get IAM role',
        signal
      )
    case 'iam_get_user':
      return executeInternalJsonToolOperation(
        awsIamGetUserContract,
        input,
        executeIamGetUser,
        'Failed to get IAM user',
        signal
      )
    case 'iam_list_access_keys':
      return executeInternalJsonToolOperation(
        awsIamListAccessKeysContract,
        input,
        executeIamListAccessKeys,
        'Failed to list access keys',
        signal
      )
    case 'iam_list_attached_role_policies':
      return executeInternalJsonToolOperation(
        awsIamListAttachedRolePoliciesContract,
        input,
        executeIamListAttachedRolePolicies,
        'Failed to list attached role policies',
        signal
      )
    case 'iam_list_attached_user_policies':
      return executeInternalJsonToolOperation(
        awsIamListAttachedUserPoliciesContract,
        input,
        executeIamListAttachedUserPolicies,
        'Failed to list attached user policies',
        signal
      )
    case 'iam_list_groups':
      return executeInternalJsonToolOperation(
        awsIamListGroupsContract,
        input,
        executeIamListGroups,
        'Failed to list IAM groups',
        signal
      )
    case 'iam_list_policies':
      return executeInternalJsonToolOperation(
        awsIamListPoliciesContract,
        input,
        executeIamListPolicies,
        'Failed to list IAM policies',
        signal
      )
    case 'iam_list_roles':
      return executeInternalJsonToolOperation(
        awsIamListRolesContract,
        input,
        executeIamListRoles,
        'Failed to list IAM roles',
        signal
      )
    case 'iam_list_users':
      return executeInternalJsonToolOperation(
        awsIamListUsersContract,
        input,
        executeIamListUsers,
        'Failed to list IAM users',
        signal
      )
    case 'iam_remove_user_from_group':
      return executeInternalJsonToolOperation(
        awsIamRemoveUserFromGroupContract,
        input,
        executeIamRemoveUserFromGroup,
        'Failed to remove user from group',
        signal
      )
    case 'iam_simulate_principal_policy':
      return executeInternalJsonToolOperation(
        awsIamSimulatePrincipalPolicyContract,
        input,
        executeIamSimulatePrincipalPolicy,
        'Failed to simulate principal policy',
        signal
      )
    case 'iam_update_access_key':
      return executeInternalJsonToolOperation(
        awsIamUpdateAccessKeyContract,
        input,
        executeIamUpdateAccessKey,
        'Failed to update access key',
        signal
      )
    default:
      return Response.json({ error: `Unsupported IAM tool: ${toolId}` }, { status: 500 })
  }
}
