import type { AwsIdentityCenterCheckAssignmentDeletionStatusBody } from '@/lib/api/contracts/tools/aws/identity-center-check-assignment-deletion-status'
import type { AwsIdentityCenterCheckAssignmentStatusBody } from '@/lib/api/contracts/tools/aws/identity-center-check-assignment-status'
import type { AwsIdentityCenterCreateAccountAssignmentBody } from '@/lib/api/contracts/tools/aws/identity-center-create-account-assignment'
import type { AwsIdentityCenterDeleteAccountAssignmentBody } from '@/lib/api/contracts/tools/aws/identity-center-delete-account-assignment'
import type { AwsIdentityCenterDescribeAccountBody } from '@/lib/api/contracts/tools/aws/identity-center-describe-account'
import type { AwsIdentityCenterDescribeGroupBody } from '@/lib/api/contracts/tools/aws/identity-center-describe-group'
import type { AwsIdentityCenterDescribeUserBody } from '@/lib/api/contracts/tools/aws/identity-center-describe-user'
import type { AwsIdentityCenterGetGroupBody } from '@/lib/api/contracts/tools/aws/identity-center-get-group'
import type { AwsIdentityCenterGetUserBody } from '@/lib/api/contracts/tools/aws/identity-center-get-user'
import type { AwsIdentityCenterListAccountAssignmentsBody } from '@/lib/api/contracts/tools/aws/identity-center-list-account-assignments'
import type { AwsIdentityCenterListAccountsBody } from '@/lib/api/contracts/tools/aws/identity-center-list-accounts'
import type { AwsIdentityCenterListAssignmentsForAccountBody } from '@/lib/api/contracts/tools/aws/identity-center-list-assignments-for-account'
import type { AwsIdentityCenterListGroupMembershipsBody } from '@/lib/api/contracts/tools/aws/identity-center-list-group-memberships'
import type { AwsIdentityCenterListGroupsBody } from '@/lib/api/contracts/tools/aws/identity-center-list-groups'
import type { AwsIdentityCenterListInstancesBody } from '@/lib/api/contracts/tools/aws/identity-center-list-instances'
import type { AwsIdentityCenterListPermissionSetsBody } from '@/lib/api/contracts/tools/aws/identity-center-list-permission-sets'
import {
  checkAssignmentCreationStatus,
  checkAssignmentDeletionStatus,
  createAccountAssignment,
  createIdentityStoreClient,
  createOrganizationsClient,
  createSSOAdminClient,
  deleteAccountAssignment,
  describeAccount,
  describeGroupById,
  describeUserById,
  getGroupByDisplayName,
  getUserByEmail,
  listAccountAssignmentsForAccount,
  listAccountAssignmentsForPrincipal,
  listAccounts,
  listGroupMemberships,
  listGroups,
  listInstances,
  listPermissionSets,
} from '@/lib/internal/identity-center/client'

export async function executeIdentityCenterListInstances(
  input: AwsIdentityCenterListInstancesBody,
  signal?: AbortSignal
) {
  const client = createSSOAdminClient(input)
  try {
    return await listInstances(client, input.maxResults, input.nextToken, signal)
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterListAccounts(
  input: AwsIdentityCenterListAccountsBody,
  signal?: AbortSignal
) {
  const client = createOrganizationsClient(input)
  try {
    return await listAccounts(client, input.maxResults, input.nextToken, signal)
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterDescribeAccount(
  input: AwsIdentityCenterDescribeAccountBody,
  signal?: AbortSignal
) {
  const client = createOrganizationsClient(input)
  try {
    return await describeAccount(client, input.accountId, signal)
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterListPermissionSets(
  input: AwsIdentityCenterListPermissionSetsBody,
  signal?: AbortSignal
) {
  const client = createSSOAdminClient(input)
  try {
    return await listPermissionSets(
      client,
      input.instanceArn,
      input.maxResults,
      input.nextToken,
      signal
    )
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterGetUser(
  input: AwsIdentityCenterGetUserBody,
  signal?: AbortSignal
) {
  const client = createIdentityStoreClient(input)
  try {
    return await getUserByEmail(client, input.identityStoreId, input.email, signal)
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterGetGroup(
  input: AwsIdentityCenterGetGroupBody,
  signal?: AbortSignal
) {
  const client = createIdentityStoreClient(input)
  try {
    return await getGroupByDisplayName(client, input.identityStoreId, input.displayName, signal)
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterListGroups(
  input: AwsIdentityCenterListGroupsBody,
  signal?: AbortSignal
) {
  const client = createIdentityStoreClient(input)
  try {
    return await listGroups(
      client,
      input.identityStoreId,
      input.maxResults,
      input.nextToken,
      signal
    )
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterCreateAccountAssignment(
  input: AwsIdentityCenterCreateAccountAssignmentBody,
  signal?: AbortSignal
) {
  const client = createSSOAdminClient(input)
  try {
    const result = await createAccountAssignment(client, input, signal)
    return {
      message: `Account assignment creation ${result.status === 'SUCCEEDED' ? 'succeeded' : 'initiated'}`,
      ...result,
    }
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterDeleteAccountAssignment(
  input: AwsIdentityCenterDeleteAccountAssignmentBody,
  signal?: AbortSignal
) {
  const client = createSSOAdminClient(input)
  try {
    const result = await deleteAccountAssignment(client, input, signal)
    return {
      message: `Account assignment deletion ${result.status === 'SUCCEEDED' ? 'succeeded' : 'initiated'}`,
      ...result,
    }
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterCheckAssignmentStatus(
  input: AwsIdentityCenterCheckAssignmentStatusBody,
  signal?: AbortSignal
) {
  const client = createSSOAdminClient(input)
  try {
    const result = await checkAssignmentCreationStatus(
      client,
      input.instanceArn,
      input.requestId,
      signal
    )
    return { message: `Assignment status: ${result.status}`, ...result }
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterCheckAssignmentDeletionStatus(
  input: AwsIdentityCenterCheckAssignmentDeletionStatusBody,
  signal?: AbortSignal
) {
  const client = createSSOAdminClient(input)
  try {
    const result = await checkAssignmentDeletionStatus(
      client,
      input.instanceArn,
      input.requestId,
      signal
    )
    return { message: `Assignment deletion status: ${result.status}`, ...result }
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterListAccountAssignments(
  input: AwsIdentityCenterListAccountAssignmentsBody,
  signal?: AbortSignal
) {
  const client = createSSOAdminClient(input)
  try {
    return await listAccountAssignmentsForPrincipal(
      client,
      input.instanceArn,
      input.principalId,
      input.principalType,
      input.maxResults,
      input.nextToken,
      signal
    )
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterListAssignmentsForAccount(
  input: AwsIdentityCenterListAssignmentsForAccountBody,
  signal?: AbortSignal
) {
  const client = createSSOAdminClient(input)
  try {
    return await listAccountAssignmentsForAccount(
      client,
      input.instanceArn,
      input.accountId,
      input.permissionSetArn,
      input.maxResults,
      input.nextToken,
      signal
    )
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterDescribeUser(
  input: AwsIdentityCenterDescribeUserBody,
  signal?: AbortSignal
) {
  const client = createIdentityStoreClient(input)
  try {
    return await describeUserById(client, input.identityStoreId, input.userId, signal)
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterDescribeGroup(
  input: AwsIdentityCenterDescribeGroupBody,
  signal?: AbortSignal
) {
  const client = createIdentityStoreClient(input)
  try {
    return await describeGroupById(client, input.identityStoreId, input.groupId, signal)
  } finally {
    client.destroy()
  }
}

export async function executeIdentityCenterListGroupMemberships(
  input: AwsIdentityCenterListGroupMembershipsBody,
  signal?: AbortSignal
) {
  const client = createIdentityStoreClient(input)
  try {
    return await listGroupMemberships(
      client,
      input.identityStoreId,
      input.groupId,
      input.maxResults,
      input.nextToken,
      signal
    )
  } finally {
    client.destroy()
  }
}
