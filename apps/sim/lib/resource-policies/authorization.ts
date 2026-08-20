import { type Principal, resolvePrincipalSubject } from '@sim/auth/principal'
import {
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import { loadResourcePolicy } from '@/lib/resource-policies/repository'
import type {
  ResourcePolicyAction,
  ResourcePolicyGrant,
  ResourcePolicyResourceType,
  ResourcePolicySubject,
} from '@/lib/resource-policies/types'
import { resolveWorkspaceGroup } from '@/ee/access-control/utils/permission-check'

interface ResourcePolicyAuthorizationInput {
  principal: Principal
  context: WorkspaceAuthorizationContext
  resourceType: ResourcePolicyResourceType
  resourceId: string
  action: ResourcePolicyAction
}

function resolveAuthorizationPrincipal(principal: Principal) {
  if (principal.kind !== 'delegated' || principal.serviceId !== 'executor') {
    return { invoker: principal, currentWorkflow: undefined }
  }
  if (!principal.delegationContext?.principal) {
    throw new Error('Resource policy evaluation requires a bound workflow execution principal')
  }
  return {
    invoker: principal.delegationContext.principal,
    currentWorkflow: principal.delegationContext.currentWorkflow,
  }
}

async function matchesSubject(
  subject: ResourcePolicySubject,
  input: ResourcePolicyAuthorizationInput,
  execution: ReturnType<typeof resolveAuthorizationPrincipal>,
  resolvers: {
    workspacePermission: () => ReturnType<typeof resolveEffectiveWorkspacePermission>
    accessControlGroupId: () => Promise<string | null>
  }
): Promise<boolean> {
  const principalSubject = resolvePrincipalSubject(execution.invoker)
  switch (subject.type) {
    case 'user':
      return principalSubject?.kind === 'sim_user' && principalSubject.userId === subject.userId
    case 'external_identity':
      return (
        principalSubject?.kind === 'external_user' &&
        principalSubject.provider === subject.provider &&
        principalSubject.tenantId === subject.tenantId &&
        principalSubject.subjectId === subject.subjectId
      )
    case 'workflow':
      return (
        execution.currentWorkflow?.mode === 'deployment' &&
        execution.currentWorkflow.workflowId === subject.workflowId
      )
    case 'workspace_role': {
      if (principalSubject?.kind !== 'sim_user') return false
      const permission = await resolvers.workspacePermission()
      return permission !== null && permissionSatisfies(permission, subject.minimumRole)
    }
    case 'access_control_group': {
      return (await resolvers.accessControlGroupId()) === subject.accessControlGroupId
    }
  }
}

export async function findResourcePolicyGrant(
  input: ResourcePolicyAuthorizationInput
): Promise<ResourcePolicyGrant | null> {
  const policy = await loadResourcePolicy({
    resourceType: input.resourceType,
    resourceId: input.resourceId,
  })
  if (!policy) return null
  if (policy.workspaceId !== input.context.workspaceId) {
    throw new Error('Resource policy workspace does not match its canonical resource')
  }
  const execution = resolveAuthorizationPrincipal(input.principal)
  const principalSubject = resolvePrincipalSubject(execution.invoker)
  let workspacePermission: ReturnType<typeof resolveEffectiveWorkspacePermission> | undefined
  let accessControlGroupId: Promise<string | null> | undefined
  const resolvers = {
    workspacePermission: () => {
      if (principalSubject?.kind !== 'sim_user') return Promise.resolve(null)
      workspacePermission ??= resolveEffectiveWorkspacePermission(
        principalSubject.userId,
        input.context.workspaceId,
        input.context.workspaceOrganizationId
      )
      return workspacePermission
    },
    accessControlGroupId: () => {
      accessControlGroupId ??= (async () => {
        if (
          principalSubject?.kind !== 'sim_user' ||
          !input.context.workspaceOrganizationId ||
          !(await isOrganizationOnEnterprisePlan(input.context.workspaceOrganizationId))
        ) {
          return null
        }
        const group = await resolveWorkspaceGroup(
          principalSubject.userId,
          input.context.workspaceOrganizationId,
          input.context.workspaceId
        )
        return group?.permissionGroupId ?? null
      })()
      return accessControlGroupId
    },
  }
  for (const grant of policy.document.grants) {
    if (!grant.actions.includes(input.action)) continue
    if (await matchesSubject(grant.subject, input, execution, resolvers)) return grant
  }
  return null
}
