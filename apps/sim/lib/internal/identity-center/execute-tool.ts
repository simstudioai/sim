import { awsIdentityCenterCheckAssignmentDeletionStatusContract } from '@/lib/api/contracts/tools/aws/identity-center-check-assignment-deletion-status'
import { awsIdentityCenterCheckAssignmentStatusContract } from '@/lib/api/contracts/tools/aws/identity-center-check-assignment-status'
import { awsIdentityCenterCreateAccountAssignmentContract } from '@/lib/api/contracts/tools/aws/identity-center-create-account-assignment'
import { awsIdentityCenterDeleteAccountAssignmentContract } from '@/lib/api/contracts/tools/aws/identity-center-delete-account-assignment'
import { awsIdentityCenterDescribeAccountContract } from '@/lib/api/contracts/tools/aws/identity-center-describe-account'
import { awsIdentityCenterDescribeGroupContract } from '@/lib/api/contracts/tools/aws/identity-center-describe-group'
import { awsIdentityCenterDescribeUserContract } from '@/lib/api/contracts/tools/aws/identity-center-describe-user'
import { awsIdentityCenterGetGroupContract } from '@/lib/api/contracts/tools/aws/identity-center-get-group'
import { awsIdentityCenterGetUserContract } from '@/lib/api/contracts/tools/aws/identity-center-get-user'
import { awsIdentityCenterListAccountAssignmentsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-account-assignments'
import { awsIdentityCenterListAccountsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-accounts'
import { awsIdentityCenterListAssignmentsForAccountContract } from '@/lib/api/contracts/tools/aws/identity-center-list-assignments-for-account'
import { awsIdentityCenterListGroupMembershipsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-group-memberships'
import { awsIdentityCenterListGroupsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-groups'
import { awsIdentityCenterListInstancesContract } from '@/lib/api/contracts/tools/aws/identity-center-list-instances'
import { awsIdentityCenterListPermissionSetsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-permission-sets'
import {
  executeIdentityCenterCheckAssignmentDeletionStatus,
  executeIdentityCenterCheckAssignmentStatus,
  executeIdentityCenterCreateAccountAssignment,
  executeIdentityCenterDeleteAccountAssignment,
  executeIdentityCenterDescribeAccount,
  executeIdentityCenterDescribeGroup,
  executeIdentityCenterDescribeUser,
  executeIdentityCenterGetGroup,
  executeIdentityCenterGetUser,
  executeIdentityCenterListAccountAssignments,
  executeIdentityCenterListAccounts,
  executeIdentityCenterListAssignmentsForAccount,
  executeIdentityCenterListGroupMemberships,
  executeIdentityCenterListGroups,
  executeIdentityCenterListInstances,
  executeIdentityCenterListPermissionSets,
} from '@/lib/internal/identity-center/operations'
import { executeInternalJsonToolOperation } from '@/lib/internal/tool-operations/execute-json-operation'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeIdentityCenterTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'identity_center_list_instances':
      return executeInternalJsonToolOperation(
        awsIdentityCenterListInstancesContract,
        input,
        executeIdentityCenterListInstances,
        'Failed to list Identity Center instances',
        signal
      )
    case 'identity_center_list_accounts':
      return executeInternalJsonToolOperation(
        awsIdentityCenterListAccountsContract,
        input,
        executeIdentityCenterListAccounts,
        'Failed to list AWS accounts',
        signal
      )
    case 'identity_center_describe_account':
      return executeInternalJsonToolOperation(
        awsIdentityCenterDescribeAccountContract,
        input,
        executeIdentityCenterDescribeAccount,
        'Failed to describe account',
        signal
      )
    case 'identity_center_list_permission_sets':
      return executeInternalJsonToolOperation(
        awsIdentityCenterListPermissionSetsContract,
        input,
        executeIdentityCenterListPermissionSets,
        'Failed to list permission sets',
        signal
      )
    case 'identity_center_get_user':
      return executeInternalJsonToolOperation(
        awsIdentityCenterGetUserContract,
        input,
        executeIdentityCenterGetUser,
        'Failed to get user',
        signal
      )
    case 'identity_center_get_group':
      return executeInternalJsonToolOperation(
        awsIdentityCenterGetGroupContract,
        input,
        executeIdentityCenterGetGroup,
        'Failed to get group',
        signal
      )
    case 'identity_center_list_groups':
      return executeInternalJsonToolOperation(
        awsIdentityCenterListGroupsContract,
        input,
        executeIdentityCenterListGroups,
        'Failed to list groups',
        signal
      )
    case 'identity_center_create_account_assignment':
      return executeInternalJsonToolOperation(
        awsIdentityCenterCreateAccountAssignmentContract,
        input,
        executeIdentityCenterCreateAccountAssignment,
        'Failed to create account assignment',
        signal
      )
    case 'identity_center_delete_account_assignment':
      return executeInternalJsonToolOperation(
        awsIdentityCenterDeleteAccountAssignmentContract,
        input,
        executeIdentityCenterDeleteAccountAssignment,
        'Failed to delete account assignment',
        signal
      )
    case 'identity_center_check_assignment_status':
      return executeInternalJsonToolOperation(
        awsIdentityCenterCheckAssignmentStatusContract,
        input,
        executeIdentityCenterCheckAssignmentStatus,
        'Failed to check assignment status',
        signal
      )
    case 'identity_center_check_assignment_deletion_status':
      return executeInternalJsonToolOperation(
        awsIdentityCenterCheckAssignmentDeletionStatusContract,
        input,
        executeIdentityCenterCheckAssignmentDeletionStatus,
        'Failed to check assignment deletion status',
        signal
      )
    case 'identity_center_list_account_assignments':
      return executeInternalJsonToolOperation(
        awsIdentityCenterListAccountAssignmentsContract,
        input,
        executeIdentityCenterListAccountAssignments,
        'Failed to list account assignments',
        signal
      )
    case 'identity_center_list_assignments_for_account':
      return executeInternalJsonToolOperation(
        awsIdentityCenterListAssignmentsForAccountContract,
        input,
        executeIdentityCenterListAssignmentsForAccount,
        'Failed to list assignments for account',
        signal
      )
    case 'identity_center_describe_user':
      return executeInternalJsonToolOperation(
        awsIdentityCenterDescribeUserContract,
        input,
        executeIdentityCenterDescribeUser,
        'Failed to describe user',
        signal
      )
    case 'identity_center_describe_group':
      return executeInternalJsonToolOperation(
        awsIdentityCenterDescribeGroupContract,
        input,
        executeIdentityCenterDescribeGroup,
        'Failed to describe group',
        signal
      )
    case 'identity_center_list_group_memberships':
      return executeInternalJsonToolOperation(
        awsIdentityCenterListGroupMembershipsContract,
        input,
        executeIdentityCenterListGroupMemberships,
        'Failed to list group memberships',
        signal
      )
    default:
      return Response.json(
        { error: `Unsupported Identity Center tool: ${toolId}` },
        { status: 500 }
      )
  }
}
