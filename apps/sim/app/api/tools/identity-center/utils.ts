import {
  DescribeGroupCommand,
  DescribeUserCommand,
  GetGroupIdCommand,
  GetUserIdCommand,
  IdentitystoreClient,
  ListGroupsCommand,
} from '@aws-sdk/client-identitystore'
import {
  DescribeAccountCommand,
  ListAccountsCommand,
  OrganizationsClient,
} from '@aws-sdk/client-organizations'
import {
  type AccountAssignmentOperationStatus,
  DescribeAccountAssignmentCreationStatusCommand,
  DescribeAccountAssignmentDeletionStatusCommand,
  DescribePermissionSetCommand,
  ListAccountAssignmentsForPrincipalCommand,
  ListInstancesCommand,
  ListPermissionSetsCommand,
  type PrincipalType,
  SSOAdminClient,
} from '@aws-sdk/client-sso-admin'
import type { IdentityCenterConnectionConfig } from '@/tools/identity_center/types'

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

export function createOrganizationsClient(config: IdentityCenterConnectionConfig) {
  return new OrganizationsClient({
    region: 'us-east-1', // Organizations API only available in us-east-1
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function listInstances(
  client: SSOAdminClient,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const command = new ListInstancesCommand({
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command)
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
  nextToken?: string | null
) {
  const command = new ListAccountsCommand({
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command)
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
  nextToken?: string | null
) {
  const listCommand = new ListPermissionSetsCommand({
    InstanceArn: instanceArn,
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const listResponse = await client.send(listCommand)
  const permissionSetArns = listResponse.PermissionSets ?? []

  const permissionSets = await Promise.all(
    permissionSetArns.map(async (arn) => {
      const describeCommand = new DescribePermissionSetCommand({
        InstanceArn: instanceArn,
        PermissionSetArn: arn,
      })
      const describeResponse = await client.send(describeCommand)
      const ps = describeResponse.PermissionSet
      return {
        permissionSetArn: ps?.PermissionSetArn ?? arn,
        name: ps?.Name ?? '',
        description: ps?.Description ?? null,
        sessionDuration: ps?.SessionDuration ?? null,
        createdDate: ps?.CreatedDate?.toISOString() ?? null,
      }
    })
  )

  return {
    permissionSets,
    nextToken: listResponse.NextToken ?? null,
    count: permissionSets.length,
  }
}

export async function getUserByEmail(
  ssoClient: IdentitystoreClient,
  identityStoreId: string,
  email: string
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
  const getUserIdResponse = await ssoClient.send(getUserIdCommand)
  const userId = getUserIdResponse.UserId ?? ''

  const describeCommand = new DescribeUserCommand({
    IdentityStoreId: identityStoreId,
    UserId: userId,
  })
  const describeResponse = await ssoClient.send(describeCommand)

  const primaryEmail =
    describeResponse.Emails?.find((e) => e.Primary)?.Value ??
    describeResponse.Emails?.[0]?.Value ??
    null

  return {
    userId,
    userName: describeResponse.UserName ?? '',
    displayName: describeResponse.DisplayName ?? null,
    email: primaryEmail,
  }
}

export function mapAssignmentStatus(status: AccountAssignmentOperationStatus) {
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

export async function checkAssignmentCreationStatus(
  client: SSOAdminClient,
  instanceArn: string,
  requestId: string
) {
  const command = new DescribeAccountAssignmentCreationStatusCommand({
    InstanceArn: instanceArn,
    AccountAssignmentCreationRequestId: requestId,
  })
  const response = await client.send(command)
  return mapAssignmentStatus(response.AccountAssignmentCreationStatus ?? {})
}

export async function checkAssignmentDeletionStatus(
  client: SSOAdminClient,
  instanceArn: string,
  requestId: string
) {
  const command = new DescribeAccountAssignmentDeletionStatusCommand({
    InstanceArn: instanceArn,
    AccountAssignmentDeletionRequestId: requestId,
  })
  const response = await client.send(command)
  return mapAssignmentStatus(response.AccountAssignmentDeletionStatus ?? {})
}

export async function listGroups(
  client: IdentitystoreClient,
  identityStoreId: string,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const command = new ListGroupsCommand({
    IdentityStoreId: identityStoreId,
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command)
  const groups = (response.Groups ?? []).map((group) => ({
    groupId: group.GroupId ?? '',
    displayName: group.DisplayName ?? null,
    description: group.Description ?? null,
    externalIds: group.ExternalIds?.map((e) => ({ issuer: e.Issuer ?? '', id: e.Id ?? '' })) ?? [],
  }))
  return { groups, nextToken: response.NextToken ?? null, count: groups.length }
}

export async function getGroupByDisplayName(
  client: IdentitystoreClient,
  identityStoreId: string,
  displayName: string
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
  const getGroupIdResponse = await client.send(getGroupIdCommand)
  const groupId = getGroupIdResponse.GroupId ?? ''

  const describeCommand = new DescribeGroupCommand({
    IdentityStoreId: identityStoreId,
    GroupId: groupId,
  })
  const describeResponse = await client.send(describeCommand)

  return {
    groupId,
    displayName: describeResponse.DisplayName ?? null,
    description: describeResponse.Description ?? null,
  }
}

export async function describeAccount(client: OrganizationsClient, accountId: string) {
  const command = new DescribeAccountCommand({ AccountId: accountId })
  const response = await client.send(command)
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
  principalType: string,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const command = new ListAccountAssignmentsForPrincipalCommand({
    InstanceArn: instanceArn,
    PrincipalId: principalId,
    PrincipalType: principalType as PrincipalType,
    ...(maxResults ? { MaxResults: maxResults } : {}),
    ...(nextToken ? { NextToken: nextToken } : {}),
  })
  const response = await client.send(command)
  const assignments = (response.AccountAssignments ?? []).map((a) => ({
    accountId: a.AccountId ?? '',
    permissionSetArn: a.PermissionSetArn ?? '',
    principalType: a.PrincipalType ?? '',
    principalId: a.PrincipalId ?? '',
  }))
  return { assignments, nextToken: response.NextToken ?? null, count: assignments.length }
}
