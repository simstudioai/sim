import {
  DescribeGroupCommand,
  DescribeUserCommand,
  GetGroupIdCommand,
  GetUserIdCommand,
  IdentitystoreClient,
  ListGroupMembershipsCommand,
  ListGroupsCommand,
} from '@aws-sdk/client-identitystore'
import {
  DescribeAccountCommand,
  ListAccountsCommand,
  OrganizationsClient,
} from '@aws-sdk/client-organizations'
import {
  type AccountAssignmentOperationStatus,
  CreateAccountAssignmentCommand,
  DeleteAccountAssignmentCommand,
  DescribeAccountAssignmentCreationStatusCommand,
  DescribeAccountAssignmentDeletionStatusCommand,
  DescribePermissionSetCommand,
  ListAccountAssignmentsCommand,
  ListAccountAssignmentsForPrincipalCommand,
  ListInstancesCommand,
  ListPermissionSetsCommand,
  type PrincipalType,
  SSOAdminClient,
  type TargetType,
} from '@aws-sdk/client-sso-admin'
import {
  AWS_FANOUT_CONCURRENCY,
  mapWithConcurrency,
  withThrottleRetry,
} from '@/lib/internal/identity-center/concurrency'
import { resolveOrganizationsRegion } from '@/lib/internal/identity-center/partition'

interface IdentityCenterConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createSSOAdminClient(config: IdentityCenterConnectionConfig): SSOAdminClient {
  return new SSOAdminClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export function createIdentityStoreClient(
  config: IdentityCenterConnectionConfig
): IdentitystoreClient {
  return new IdentitystoreClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

/**
 * AWS Organizations is global *per partition*, so the client signs for the
 * caller's partition home region rather than the caller's own region.
 */
export function createOrganizationsClient(config: IdentityCenterConnectionConfig) {
  return new OrganizationsClient({
    region: resolveOrganizationsRegion(config.region),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function listInstances(
  client: SSOAdminClient,
  maxResults?: number | null,
  nextToken?: string | null,
  signal?: AbortSignal
) {
  const command = new ListInstancesCommand({
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command, { abortSignal: signal })
  const instances = (response.Instances ?? []).map((instance) => ({
    instanceArn: instance.InstanceArn ?? '',
    identityStoreId: instance.IdentityStoreId ?? '',
    name: instance.Name ?? null,
    status: instance.Status ?? '',
    statusReason: instance.StatusReason ?? null,
    ownerAccountId: instance.OwnerAccountId ?? null,
    createdDate: instance.CreatedDate?.toISOString() ?? null,
  }))
  return { instances, nextToken: response.NextToken ?? null, count: instances.length }
}

export async function listAccounts(
  client: OrganizationsClient,
  maxResults?: number | null,
  nextToken?: string | null,
  signal?: AbortSignal
) {
  const command = new ListAccountsCommand({
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command, { abortSignal: signal })
  const accounts = (response.Accounts ?? []).map((account) => ({
    id: account.Id ?? '',
    arn: account.Arn ?? '',
    name: account.Name ?? '',
    email: account.Email ?? '',
    status: account.State ?? '',
    joinedTimestamp: account.JoinedTimestamp?.toISOString() ?? null,
  }))
  return { accounts, nextToken: response.NextToken ?? null, count: accounts.length }
}

export async function listPermissionSets(
  client: SSOAdminClient,
  instanceArn: string,
  maxResults?: number | null,
  nextToken?: string | null,
  signal?: AbortSignal
) {
  const listCommand = new ListPermissionSetsCommand({
    InstanceArn: instanceArn,
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const listResponse = await client.send(listCommand, { abortSignal: signal })
  const permissionSetArns = listResponse.PermissionSets ?? []

  const permissionSets = await mapWithConcurrency(
    permissionSetArns,
    AWS_FANOUT_CONCURRENCY,
    async (arn) => {
      const describeCommand = new DescribePermissionSetCommand({
        InstanceArn: instanceArn,
        PermissionSetArn: arn,
      })
      const describeResponse = await withThrottleRetry(
        () => client.send(describeCommand, { abortSignal: signal }),
        signal
      )
      const permissionSet = describeResponse.PermissionSet
      return {
        permissionSetArn: permissionSet?.PermissionSetArn ?? arn,
        name: permissionSet?.Name ?? '',
        description: permissionSet?.Description ?? null,
        sessionDuration: permissionSet?.SessionDuration ?? null,
        createdDate: permissionSet?.CreatedDate?.toISOString() ?? null,
      }
    }
  )

  return {
    permissionSets,
    nextToken: listResponse.NextToken ?? null,
    count: permissionSets.length,
  }
}

export async function getUserByEmail(
  client: IdentitystoreClient,
  identityStoreId: string,
  email: string,
  signal?: AbortSignal
) {
  const getUserIdCommand = new GetUserIdCommand({
    IdentityStoreId: identityStoreId,
    AlternateIdentifier: {
      UniqueAttribute: {
        AttributePath: 'emails.value',
        AttributeValue: email,
      },
    },
  })
  const getUserIdResponse = await client.send(getUserIdCommand, { abortSignal: signal })
  const userId = getUserIdResponse.UserId ?? ''

  const describeCommand = new DescribeUserCommand({
    IdentityStoreId: identityStoreId,
    UserId: userId,
  })
  const describeResponse = await client.send(describeCommand, { abortSignal: signal })

  const primaryEmail =
    describeResponse.Emails?.find((entry) => entry.Primary)?.Value ??
    describeResponse.Emails?.[0]?.Value ??
    null

  return {
    userId,
    userName: describeResponse.UserName ?? '',
    displayName: describeResponse.DisplayName ?? null,
    email: primaryEmail,
  }
}

function mapAssignmentStatus(status: AccountAssignmentOperationStatus) {
  return {
    status: status.Status ?? '',
    requestId: status.RequestId ?? '',
    accountId: status.TargetId ?? null,
    permissionSetArn: status.PermissionSetArn ?? null,
    principalType: status.PrincipalType ?? null,
    principalId: status.PrincipalId ?? null,
    failureReason: status.FailureReason ?? null,
    createdDate: status.CreatedDate?.toISOString() ?? null,
  }
}

interface AccountAssignmentInput {
  instanceArn: string
  accountId: string
  permissionSetArn: string
  principalType: 'USER' | 'GROUP'
  principalId: string
}

export async function createAccountAssignment(
  client: SSOAdminClient,
  input: AccountAssignmentInput,
  signal?: AbortSignal
) {
  const command = new CreateAccountAssignmentCommand({
    InstanceArn: input.instanceArn,
    TargetId: input.accountId,
    TargetType: 'AWS_ACCOUNT' as TargetType,
    PermissionSetArn: input.permissionSetArn,
    PrincipalType: input.principalType as PrincipalType,
    PrincipalId: input.principalId,
  })
  const response = await client.send(command, { abortSignal: signal })
  return mapAssignmentStatus(response.AccountAssignmentCreationStatus ?? {})
}

export async function deleteAccountAssignment(
  client: SSOAdminClient,
  input: AccountAssignmentInput,
  signal?: AbortSignal
) {
  const command = new DeleteAccountAssignmentCommand({
    InstanceArn: input.instanceArn,
    TargetId: input.accountId,
    TargetType: 'AWS_ACCOUNT' as TargetType,
    PermissionSetArn: input.permissionSetArn,
    PrincipalType: input.principalType as PrincipalType,
    PrincipalId: input.principalId,
  })
  const response = await client.send(command, { abortSignal: signal })
  return mapAssignmentStatus(response.AccountAssignmentDeletionStatus ?? {})
}

export async function checkAssignmentCreationStatus(
  client: SSOAdminClient,
  instanceArn: string,
  requestId: string,
  signal?: AbortSignal
) {
  const command = new DescribeAccountAssignmentCreationStatusCommand({
    InstanceArn: instanceArn,
    AccountAssignmentCreationRequestId: requestId,
  })
  const response = await client.send(command, { abortSignal: signal })
  return mapAssignmentStatus(response.AccountAssignmentCreationStatus ?? {})
}

export async function checkAssignmentDeletionStatus(
  client: SSOAdminClient,
  instanceArn: string,
  requestId: string,
  signal?: AbortSignal
) {
  const command = new DescribeAccountAssignmentDeletionStatusCommand({
    InstanceArn: instanceArn,
    AccountAssignmentDeletionRequestId: requestId,
  })
  const response = await client.send(command, { abortSignal: signal })
  return mapAssignmentStatus(response.AccountAssignmentDeletionStatus ?? {})
}

export async function listGroups(
  client: IdentitystoreClient,
  identityStoreId: string,
  maxResults?: number | null,
  nextToken?: string | null,
  signal?: AbortSignal
) {
  const command = new ListGroupsCommand({
    IdentityStoreId: identityStoreId,
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command, { abortSignal: signal })
  const groups = (response.Groups ?? []).map((group) => ({
    groupId: group.GroupId ?? '',
    displayName: group.DisplayName ?? null,
    description: group.Description ?? null,
    externalIds:
      group.ExternalIds?.map((externalId) => ({
        issuer: externalId.Issuer ?? '',
        id: externalId.Id ?? '',
      })) ?? [],
  }))
  return { groups, nextToken: response.NextToken ?? null, count: groups.length }
}

export async function getGroupByDisplayName(
  client: IdentitystoreClient,
  identityStoreId: string,
  displayName: string,
  signal?: AbortSignal
) {
  const getGroupIdCommand = new GetGroupIdCommand({
    IdentityStoreId: identityStoreId,
    AlternateIdentifier: {
      UniqueAttribute: {
        AttributePath: 'displayName',
        AttributeValue: displayName,
      },
    },
  })
  const getGroupIdResponse = await client.send(getGroupIdCommand, { abortSignal: signal })
  const groupId = getGroupIdResponse.GroupId ?? ''

  const describeCommand = new DescribeGroupCommand({
    IdentityStoreId: identityStoreId,
    GroupId: groupId,
  })
  const describeResponse = await client.send(describeCommand, { abortSignal: signal })

  return {
    groupId,
    displayName: describeResponse.DisplayName ?? null,
    description: describeResponse.Description ?? null,
  }
}

export async function describeAccount(
  client: OrganizationsClient,
  accountId: string,
  signal?: AbortSignal
) {
  const command = new DescribeAccountCommand({ AccountId: accountId })
  const response = await client.send(command, { abortSignal: signal })
  const account = response.Account
  return {
    id: account?.Id ?? '',
    arn: account?.Arn ?? '',
    name: account?.Name ?? '',
    email: account?.Email ?? '',
    status: account?.State ?? '',
    joinedTimestamp: account?.JoinedTimestamp?.toISOString() ?? null,
  }
}

export async function listAccountAssignmentsForPrincipal(
  client: SSOAdminClient,
  instanceArn: string,
  principalId: string,
  principalType: 'USER' | 'GROUP',
  maxResults?: number | null,
  nextToken?: string | null,
  signal?: AbortSignal
) {
  const command = new ListAccountAssignmentsForPrincipalCommand({
    InstanceArn: instanceArn,
    PrincipalId: principalId,
    PrincipalType: principalType as PrincipalType,
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command, { abortSignal: signal })
  const assignments = (response.AccountAssignments ?? []).map((assignment) => ({
    accountId: assignment.AccountId ?? '',
    permissionSetArn: assignment.PermissionSetArn ?? '',
    principalType: assignment.PrincipalType ?? '',
    principalId: assignment.PrincipalId ?? '',
  }))
  return { assignments, nextToken: response.NextToken ?? null, count: assignments.length }
}

export async function listAccountAssignmentsForAccount(
  client: SSOAdminClient,
  instanceArn: string,
  accountId: string,
  permissionSetArn: string,
  maxResults?: number | null,
  nextToken?: string | null,
  signal?: AbortSignal
) {
  const command = new ListAccountAssignmentsCommand({
    InstanceArn: instanceArn,
    AccountId: accountId,
    PermissionSetArn: permissionSetArn,
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command, { abortSignal: signal })
  const assignments = (response.AccountAssignments ?? []).map((assignment) => ({
    accountId: assignment.AccountId ?? accountId,
    permissionSetArn: assignment.PermissionSetArn ?? permissionSetArn,
    principalType: assignment.PrincipalType ?? '',
    principalId: assignment.PrincipalId ?? '',
  }))
  return { assignments, nextToken: response.NextToken ?? null, count: assignments.length }
}

export async function describeUserById(
  client: IdentitystoreClient,
  identityStoreId: string,
  userId: string,
  signal?: AbortSignal
) {
  const command = new DescribeUserCommand({ IdentityStoreId: identityStoreId, UserId: userId })
  const response = await client.send(command, { abortSignal: signal })
  const primaryEmail =
    response.Emails?.find((entry) => entry.Primary)?.Value ?? response.Emails?.[0]?.Value ?? null

  return {
    userId: response.UserId ?? userId,
    userName: response.UserName ?? '',
    displayName: response.DisplayName ?? null,
    email: primaryEmail,
    userStatus: response.UserStatus ?? null,
    title: response.Title ?? null,
    externalIds:
      response.ExternalIds?.map((externalId) => ({
        issuer: externalId.Issuer ?? '',
        id: externalId.Id ?? '',
      })) ?? [],
  }
}

export async function describeGroupById(
  client: IdentitystoreClient,
  identityStoreId: string,
  groupId: string,
  signal?: AbortSignal
) {
  const command = new DescribeGroupCommand({ IdentityStoreId: identityStoreId, GroupId: groupId })
  const response = await client.send(command, { abortSignal: signal })
  return {
    groupId: response.GroupId ?? groupId,
    displayName: response.DisplayName ?? null,
    description: response.Description ?? null,
    externalIds:
      response.ExternalIds?.map((externalId) => ({
        issuer: externalId.Issuer ?? '',
        id: externalId.Id ?? '',
      })) ?? [],
  }
}

export async function listGroupMemberships(
  client: IdentitystoreClient,
  identityStoreId: string,
  groupId: string,
  maxResults?: number | null,
  nextToken?: string | null,
  signal?: AbortSignal
) {
  const command = new ListGroupMembershipsCommand({
    IdentityStoreId: identityStoreId,
    GroupId: groupId,
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command, { abortSignal: signal })
  const memberships = (response.GroupMemberships ?? []).map((membership) => ({
    membershipId: membership.MembershipId ?? '',
    groupId: membership.GroupId ?? groupId,
    userId:
      membership.MemberId && 'UserId' in membership.MemberId
        ? (membership.MemberId.UserId ?? null)
        : null,
  }))
  return { memberships, nextToken: response.NextToken ?? null, count: memberships.length }
}
