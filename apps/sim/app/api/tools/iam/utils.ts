import type {
  AttachedPolicy,
  Group,
  Policy,
  PolicyScopeType,
  Role,
  User,
} from '@aws-sdk/client-iam'
import {
  AddUserToGroupCommand,
  AttachRolePolicyCommand,
  AttachUserPolicyCommand,
  CreateAccessKeyCommand,
  CreateRoleCommand,
  CreateUserCommand,
  DeleteAccessKeyCommand,
  DeleteRoleCommand,
  DeleteUserCommand,
  DetachRolePolicyCommand,
  DetachUserPolicyCommand,
  GetRoleCommand,
  GetUserCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListAttachedUserPoliciesCommand,
  ListGroupsCommand,
  ListPoliciesCommand,
  ListRolesCommand,
  ListUsersCommand,
  RemoveUserFromGroupCommand,
  SimulatePrincipalPolicyCommand,
} from '@aws-sdk/client-iam'
import type { IAMConnectionConfig } from '@/tools/iam/types'

export function createIAMClient(config: IAMConnectionConfig): IAMClient {
  return new IAMClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function listUsers(
  client: IAMClient,
  pathPrefix?: string | null,
  maxItems?: number | null,
  marker?: string | null
) {
  const command = new ListUsersCommand({
    ...(pathPrefix ? { PathPrefix: pathPrefix } : {}),
    ...(maxItems ? { MaxItems: maxItems } : {}),
    ...(marker ? { Marker: marker } : {}),
  })

  const response = await client.send(command)
  const users = (response.Users ?? []).map((user: User) => ({
    userName: user.UserName ?? '',
    userId: user.UserId ?? '',
    arn: user.Arn ?? '',
    path: user.Path ?? '',
    createDate: user.CreateDate?.toISOString() ?? null,
    passwordLastUsed: user.PasswordLastUsed?.toISOString() ?? null,
  }))

  return {
    users,
    isTruncated: response.IsTruncated ?? false,
    marker: response.Marker ?? null,
    count: users.length,
  }
}

export async function getUser(client: IAMClient, userName?: string | null) {
  const command = new GetUserCommand(userName ? { UserName: userName } : {})
  const response = await client.send(command)
  const user = response.User

  return {
    userName: user?.UserName ?? '',
    userId: user?.UserId ?? '',
    arn: user?.Arn ?? '',
    path: user?.Path ?? '',
    createDate: user?.CreateDate?.toISOString() ?? null,
    passwordLastUsed: user?.PasswordLastUsed?.toISOString() ?? null,
    permissionsBoundaryArn: user?.PermissionsBoundary?.PermissionsBoundaryArn ?? null,
    tags: user?.Tags?.map((t) => ({ key: t.Key ?? '', value: t.Value ?? '' })) ?? [],
  }
}

export async function createUser(client: IAMClient, userName: string, path?: string | null) {
  const command = new CreateUserCommand({
    UserName: userName,
    ...(path ? { Path: path } : {}),
  })

  const response = await client.send(command)
  const user = response.User

  return {
    userName: user?.UserName ?? '',
    userId: user?.UserId ?? '',
    arn: user?.Arn ?? '',
    path: user?.Path ?? '',
    createDate: user?.CreateDate?.toISOString() ?? null,
  }
}

export async function deleteUser(client: IAMClient, userName: string) {
  const command = new DeleteUserCommand({ UserName: userName })
  await client.send(command)
}

export async function listRoles(
  client: IAMClient,
  pathPrefix?: string | null,
  maxItems?: number | null,
  marker?: string | null
) {
  const command = new ListRolesCommand({
    ...(pathPrefix ? { PathPrefix: pathPrefix } : {}),
    ...(maxItems ? { MaxItems: maxItems } : {}),
    ...(marker ? { Marker: marker } : {}),
  })

  const response = await client.send(command)
  const roles = (response.Roles ?? []).map((role: Role) => ({
    roleName: role.RoleName ?? '',
    roleId: role.RoleId ?? '',
    arn: role.Arn ?? '',
    path: role.Path ?? '',
    createDate: role.CreateDate?.toISOString() ?? null,
    description: role.Description ?? null,
    maxSessionDuration: role.MaxSessionDuration ?? null,
  }))

  return {
    roles,
    isTruncated: response.IsTruncated ?? false,
    marker: response.Marker ?? null,
    count: roles.length,
  }
}

export async function getRole(client: IAMClient, roleName: string) {
  const command = new GetRoleCommand({ RoleName: roleName })
  const response = await client.send(command)
  const role = response.Role

  let policyDocument: string | null = null
  if (role?.AssumeRolePolicyDocument) {
    try {
      policyDocument = decodeURIComponent(role.AssumeRolePolicyDocument)
    } catch {
      policyDocument = role.AssumeRolePolicyDocument
    }
  }

  return {
    roleName: role?.RoleName ?? '',
    roleId: role?.RoleId ?? '',
    arn: role?.Arn ?? '',
    path: role?.Path ?? '',
    createDate: role?.CreateDate?.toISOString() ?? null,
    description: role?.Description ?? null,
    maxSessionDuration: role?.MaxSessionDuration ?? null,
    assumeRolePolicyDocument: policyDocument,
    roleLastUsedDate: role?.RoleLastUsed?.LastUsedDate?.toISOString() ?? null,
    roleLastUsedRegion: role?.RoleLastUsed?.Region ?? null,
  }
}

export async function createRole(
  client: IAMClient,
  roleName: string,
  assumeRolePolicyDocument: string,
  description?: string | null,
  path?: string | null,
  maxSessionDuration?: number | null
) {
  const command = new CreateRoleCommand({
    RoleName: roleName,
    AssumeRolePolicyDocument: assumeRolePolicyDocument,
    ...(description ? { Description: description } : {}),
    ...(path ? { Path: path } : {}),
    ...(maxSessionDuration ? { MaxSessionDuration: maxSessionDuration } : {}),
  })

  const response = await client.send(command)
  const role = response.Role

  return {
    roleName: role?.RoleName ?? '',
    roleId: role?.RoleId ?? '',
    arn: role?.Arn ?? '',
    path: role?.Path ?? '',
    createDate: role?.CreateDate?.toISOString() ?? null,
  }
}

export async function deleteRole(client: IAMClient, roleName: string) {
  const command = new DeleteRoleCommand({ RoleName: roleName })
  await client.send(command)
}

export async function attachUserPolicy(client: IAMClient, userName: string, policyArn: string) {
  const command = new AttachUserPolicyCommand({
    UserName: userName,
    PolicyArn: policyArn,
  })
  await client.send(command)
}

export async function detachUserPolicy(client: IAMClient, userName: string, policyArn: string) {
  const command = new DetachUserPolicyCommand({
    UserName: userName,
    PolicyArn: policyArn,
  })
  await client.send(command)
}

export async function attachRolePolicy(client: IAMClient, roleName: string, policyArn: string) {
  const command = new AttachRolePolicyCommand({
    RoleName: roleName,
    PolicyArn: policyArn,
  })
  await client.send(command)
}

export async function detachRolePolicy(client: IAMClient, roleName: string, policyArn: string) {
  const command = new DetachRolePolicyCommand({
    RoleName: roleName,
    PolicyArn: policyArn,
  })
  await client.send(command)
}

export async function listPolicies(
  client: IAMClient,
  scope?: string | null,
  onlyAttached?: boolean | null,
  pathPrefix?: string | null,
  maxItems?: number | null,
  marker?: string | null
) {
  const command = new ListPoliciesCommand({
    ...(scope ? { Scope: scope as PolicyScopeType } : {}),
    ...(onlyAttached != null ? { OnlyAttached: onlyAttached } : {}),
    ...(pathPrefix ? { PathPrefix: pathPrefix } : {}),
    ...(maxItems ? { MaxItems: maxItems } : {}),
    ...(marker ? { Marker: marker } : {}),
  })

  const response = await client.send(command)
  const policies = (response.Policies ?? []).map((policy: Policy) => ({
    policyName: policy.PolicyName ?? '',
    policyId: policy.PolicyId ?? '',
    arn: policy.Arn ?? '',
    path: policy.Path ?? '',
    attachmentCount: policy.AttachmentCount ?? 0,
    isAttachable: policy.IsAttachable ?? false,
    createDate: policy.CreateDate?.toISOString() ?? null,
    updateDate: policy.UpdateDate?.toISOString() ?? null,
    description: policy.Description ?? null,
    defaultVersionId: policy.DefaultVersionId ?? null,
    permissionsBoundaryUsageCount: policy.PermissionsBoundaryUsageCount ?? 0,
  }))

  return {
    policies,
    isTruncated: response.IsTruncated ?? false,
    marker: response.Marker ?? null,
    count: policies.length,
  }
}

export async function createAccessKey(client: IAMClient, userName?: string | null) {
  const command = new CreateAccessKeyCommand({
    ...(userName ? { UserName: userName } : {}),
  })

  const response = await client.send(command)
  const key = response.AccessKey

  return {
    accessKeyId: key?.AccessKeyId ?? '',
    secretAccessKey: key?.SecretAccessKey ?? '',
    userName: key?.UserName ?? '',
    status: key?.Status ?? '',
    createDate: key?.CreateDate?.toISOString() ?? null,
  }
}

export async function deleteAccessKey(
  client: IAMClient,
  accessKeyIdToDelete: string,
  userName?: string | null
) {
  const command = new DeleteAccessKeyCommand({
    AccessKeyId: accessKeyIdToDelete,
    ...(userName ? { UserName: userName } : {}),
  })
  await client.send(command)
}

export async function listGroups(
  client: IAMClient,
  pathPrefix?: string | null,
  maxItems?: number | null,
  marker?: string | null
) {
  const command = new ListGroupsCommand({
    ...(pathPrefix ? { PathPrefix: pathPrefix } : {}),
    ...(maxItems ? { MaxItems: maxItems } : {}),
    ...(marker ? { Marker: marker } : {}),
  })

  const response = await client.send(command)
  const groups = (response.Groups ?? []).map((group: Group) => ({
    groupName: group.GroupName ?? '',
    groupId: group.GroupId ?? '',
    arn: group.Arn ?? '',
    path: group.Path ?? '',
    createDate: group.CreateDate?.toISOString() ?? null,
  }))

  return {
    groups,
    isTruncated: response.IsTruncated ?? false,
    marker: response.Marker ?? null,
    count: groups.length,
  }
}

export async function addUserToGroup(client: IAMClient, userName: string, groupName: string) {
  const command = new AddUserToGroupCommand({
    UserName: userName,
    GroupName: groupName,
  })
  await client.send(command)
}

export async function removeUserFromGroup(client: IAMClient, userName: string, groupName: string) {
  const command = new RemoveUserFromGroupCommand({
    UserName: userName,
    GroupName: groupName,
  })
  await client.send(command)
}

export async function listAttachedRolePolicies(
  client: IAMClient,
  roleName: string,
  pathPrefix?: string | null,
  maxItems?: number | null,
  marker?: string | null
) {
  const command = new ListAttachedRolePoliciesCommand({
    RoleName: roleName,
    ...(pathPrefix ? { PathPrefix: pathPrefix } : {}),
    ...(maxItems ? { MaxItems: maxItems } : {}),
    ...(marker ? { Marker: marker } : {}),
  })

  const response = await client.send(command)
  const attachedPolicies = (response.AttachedPolicies ?? []).map((p: AttachedPolicy) => ({
    policyName: p.PolicyName ?? '',
    policyArn: p.PolicyArn ?? '',
  }))

  return {
    attachedPolicies,
    isTruncated: response.IsTruncated ?? false,
    marker: response.Marker ?? null,
    count: attachedPolicies.length,
  }
}

export async function listAttachedUserPolicies(
  client: IAMClient,
  userName: string,
  pathPrefix?: string | null,
  maxItems?: number | null,
  marker?: string | null
) {
  const command = new ListAttachedUserPoliciesCommand({
    UserName: userName,
    ...(pathPrefix ? { PathPrefix: pathPrefix } : {}),
    ...(maxItems ? { MaxItems: maxItems } : {}),
    ...(marker ? { Marker: marker } : {}),
  })

  const response = await client.send(command)
  const attachedPolicies = (response.AttachedPolicies ?? []).map((p: AttachedPolicy) => ({
    policyName: p.PolicyName ?? '',
    policyArn: p.PolicyArn ?? '',
  }))

  return {
    attachedPolicies,
    isTruncated: response.IsTruncated ?? false,
    marker: response.Marker ?? null,
    count: attachedPolicies.length,
  }
}

export async function simulatePrincipalPolicy(
  client: IAMClient,
  policySourceArn: string,
  actionNames: string,
  resourceArns?: string | null,
  maxResults?: number | null,
  marker?: string | null
) {
  const actions = actionNames
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
  const resources = resourceArns
    ? resourceArns
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
    : ['*']

  const command = new SimulatePrincipalPolicyCommand({
    PolicySourceArn: policySourceArn,
    ActionNames: actions,
    ResourceArns: resources,
    ...(maxResults ? { MaxItems: maxResults } : {}),
    ...(marker ? { Marker: marker } : {}),
  })

  const response = await client.send(command)
  const evaluationResults = (response.EvaluationResults ?? []).map((r) => ({
    evalActionName: r.EvalActionName ?? '',
    evalResourceName: r.EvalResourceName ?? '',
    evalDecision: r.EvalDecision ?? '',
    matchedStatements: (r.MatchedStatements ?? []).map((s) => ({
      sourcePolicyId: s.SourcePolicyId ?? '',
      sourcePolicyType: s.SourcePolicyType ?? '',
    })),
    missingContextValues: (r.MissingContextValues ?? []).map((v) => String(v)),
  }))

  return {
    evaluationResults,
    isTruncated: response.IsTruncated ?? false,
    marker: response.Marker ?? null,
    count: evaluationResults.length,
  }
}
