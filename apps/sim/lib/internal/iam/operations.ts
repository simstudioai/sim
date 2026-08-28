import type { IAMClient } from '@aws-sdk/client-iam'
import type { AwsIamAddUserToGroupBody } from '@/lib/api/contracts/tools/aws/iam-add-user-to-group'
import type { AwsIamAttachRolePolicyBody } from '@/lib/api/contracts/tools/aws/iam-attach-role-policy'
import type { AwsIamAttachUserPolicyBody } from '@/lib/api/contracts/tools/aws/iam-attach-user-policy'
import type { AwsIamCreateAccessKeyBody } from '@/lib/api/contracts/tools/aws/iam-create-access-key'
import type { AwsIamCreateRoleBody } from '@/lib/api/contracts/tools/aws/iam-create-role'
import type { AwsIamCreateUserBody } from '@/lib/api/contracts/tools/aws/iam-create-user'
import type { AwsIamDeleteAccessKeyBody } from '@/lib/api/contracts/tools/aws/iam-delete-access-key'
import type { AwsIamDeleteRoleBody } from '@/lib/api/contracts/tools/aws/iam-delete-role'
import type { AwsIamDeleteUserBody } from '@/lib/api/contracts/tools/aws/iam-delete-user'
import type { AwsIamDetachRolePolicyBody } from '@/lib/api/contracts/tools/aws/iam-detach-role-policy'
import type { AwsIamDetachUserPolicyBody } from '@/lib/api/contracts/tools/aws/iam-detach-user-policy'
import type { AwsIamGetRoleBody } from '@/lib/api/contracts/tools/aws/iam-get-role'
import type { AwsIamGetUserBody } from '@/lib/api/contracts/tools/aws/iam-get-user'
import type { AwsIamListAttachedRolePoliciesBody } from '@/lib/api/contracts/tools/aws/iam-list-attached-role-policies'
import type { AwsIamListAttachedUserPoliciesBody } from '@/lib/api/contracts/tools/aws/iam-list-attached-user-policies'
import type { AwsIamListGroupsBody } from '@/lib/api/contracts/tools/aws/iam-list-groups'
import type { AwsIamListPoliciesBody } from '@/lib/api/contracts/tools/aws/iam-list-policies'
import type { AwsIamListRolesBody } from '@/lib/api/contracts/tools/aws/iam-list-roles'
import type { AwsIamListUsersBody } from '@/lib/api/contracts/tools/aws/iam-list-users'
import type { AwsIamRemoveUserFromGroupBody } from '@/lib/api/contracts/tools/aws/iam-remove-user-from-group'
import type { AwsIamSimulatePrincipalPolicyBody } from '@/lib/api/contracts/tools/aws/iam-simulate-principal-policy'
import {
  addUserToGroup,
  attachRolePolicy,
  attachUserPolicy,
  createAccessKey,
  createIAMClient,
  createRole,
  createUser,
  deleteAccessKey,
  deleteRole,
  deleteUser,
  detachRolePolicy,
  detachUserPolicy,
  getRole,
  getUser,
  listAttachedRolePolicies,
  listAttachedUserPolicies,
  listGroups,
  listPolicies,
  listRoles,
  listUsers,
  removeUserFromGroup,
  simulatePrincipalPolicy,
} from '@/lib/internal/iam/client'
import type { IAMConnectionConfig } from '@/tools/iam/types'

async function withIamClient<T>(
  config: IAMConnectionConfig,
  operation: (client: IAMClient) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const client = createIAMClient(config)
  try {
    const result = await operation(client)
    signal?.throwIfAborted()
    return result
  } finally {
    client.destroy()
  }
}

export async function executeIamListUsers(input: AwsIamListUsersBody, signal?: AbortSignal) {
  return withIamClient(
    input,
    (client) => listUsers(client, input.pathPrefix, input.maxItems, input.marker, signal),
    signal
  )
}

export async function executeIamGetUser(input: AwsIamGetUserBody, signal?: AbortSignal) {
  return withIamClient(input, (client) => getUser(client, input.userName, signal), signal)
}

export async function executeIamCreateUser(input: AwsIamCreateUserBody, signal?: AbortSignal) {
  return withIamClient(
    input,
    async (client) => {
      const result = await createUser(client, input.userName, input.path, signal)
      return { message: `User "${result.userName}" created successfully`, ...result }
    },
    signal
  )
}

export async function executeIamDeleteUser(input: AwsIamDeleteUserBody, signal?: AbortSignal) {
  return withIamClient(
    input,
    async (client) => {
      await deleteUser(client, input.userName, signal)
      return { message: `User "${input.userName}" deleted successfully` }
    },
    signal
  )
}

export async function executeIamListRoles(input: AwsIamListRolesBody, signal?: AbortSignal) {
  return withIamClient(
    input,
    (client) => listRoles(client, input.pathPrefix, input.maxItems, input.marker, signal),
    signal
  )
}

export async function executeIamGetRole(input: AwsIamGetRoleBody, signal?: AbortSignal) {
  return withIamClient(input, (client) => getRole(client, input.roleName, signal), signal)
}

export async function executeIamCreateRole(input: AwsIamCreateRoleBody, signal?: AbortSignal) {
  return withIamClient(
    input,
    async (client) => {
      const result = await createRole(
        client,
        input.roleName,
        input.assumeRolePolicyDocument,
        input.description,
        input.path,
        input.maxSessionDuration,
        signal
      )
      return { message: `Role "${result.roleName}" created successfully`, ...result }
    },
    signal
  )
}

export async function executeIamDeleteRole(input: AwsIamDeleteRoleBody, signal?: AbortSignal) {
  return withIamClient(
    input,
    async (client) => {
      await deleteRole(client, input.roleName, signal)
      return { message: `Role "${input.roleName}" deleted successfully` }
    },
    signal
  )
}

export async function executeIamAttachUserPolicy(
  input: AwsIamAttachUserPolicyBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    async (client) => {
      await attachUserPolicy(client, input.userName, input.policyArn, signal)
      return { message: `Policy "${input.policyArn}" attached to user "${input.userName}"` }
    },
    signal
  )
}

export async function executeIamDetachUserPolicy(
  input: AwsIamDetachUserPolicyBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    async (client) => {
      await detachUserPolicy(client, input.userName, input.policyArn, signal)
      return { message: `Policy "${input.policyArn}" detached from user "${input.userName}"` }
    },
    signal
  )
}

export async function executeIamAttachRolePolicy(
  input: AwsIamAttachRolePolicyBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    async (client) => {
      await attachRolePolicy(client, input.roleName, input.policyArn, signal)
      return { message: `Policy "${input.policyArn}" attached to role "${input.roleName}"` }
    },
    signal
  )
}

export async function executeIamDetachRolePolicy(
  input: AwsIamDetachRolePolicyBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    async (client) => {
      await detachRolePolicy(client, input.roleName, input.policyArn, signal)
      return { message: `Policy "${input.policyArn}" detached from role "${input.roleName}"` }
    },
    signal
  )
}

export async function executeIamListPolicies(input: AwsIamListPoliciesBody, signal?: AbortSignal) {
  return withIamClient(
    input,
    (client) =>
      listPolicies(
        client,
        input.scope,
        input.onlyAttached,
        input.pathPrefix,
        input.maxItems,
        input.marker,
        signal
      ),
    signal
  )
}

export async function executeIamCreateAccessKey(
  input: AwsIamCreateAccessKeyBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    async (client) => {
      const result = await createAccessKey(client, input.userName, signal)
      return { message: `Access key created for user "${result.userName}"`, ...result }
    },
    signal
  )
}

export async function executeIamDeleteAccessKey(
  input: AwsIamDeleteAccessKeyBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    async (client) => {
      await deleteAccessKey(client, input.accessKeyIdToDelete, input.userName, signal)
      return { message: `Access key "${input.accessKeyIdToDelete}" deleted` }
    },
    signal
  )
}

export async function executeIamListGroups(input: AwsIamListGroupsBody, signal?: AbortSignal) {
  return withIamClient(
    input,
    (client) => listGroups(client, input.pathPrefix, input.maxItems, input.marker, signal),
    signal
  )
}

export async function executeIamAddUserToGroup(
  input: AwsIamAddUserToGroupBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    async (client) => {
      await addUserToGroup(client, input.userName, input.groupName, signal)
      return { message: `User "${input.userName}" added to group "${input.groupName}"` }
    },
    signal
  )
}

export async function executeIamRemoveUserFromGroup(
  input: AwsIamRemoveUserFromGroupBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    async (client) => {
      await removeUserFromGroup(client, input.userName, input.groupName, signal)
      return { message: `User "${input.userName}" removed from group "${input.groupName}"` }
    },
    signal
  )
}

export async function executeIamListAttachedRolePolicies(
  input: AwsIamListAttachedRolePoliciesBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    (client) =>
      listAttachedRolePolicies(
        client,
        input.roleName,
        input.pathPrefix,
        input.maxItems,
        input.marker,
        signal
      ),
    signal
  )
}

export async function executeIamListAttachedUserPolicies(
  input: AwsIamListAttachedUserPoliciesBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    (client) =>
      listAttachedUserPolicies(
        client,
        input.userName,
        input.pathPrefix,
        input.maxItems,
        input.marker,
        signal
      ),
    signal
  )
}

export async function executeIamSimulatePrincipalPolicy(
  input: AwsIamSimulatePrincipalPolicyBody,
  signal?: AbortSignal
) {
  return withIamClient(
    input,
    (client) =>
      simulatePrincipalPolicy(
        client,
        input.policySourceArn,
        input.actionNames,
        input.resourceArns,
        input.maxResults,
        input.marker,
        signal
      ),
    signal
  )
}
